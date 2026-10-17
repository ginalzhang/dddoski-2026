"""Bounded HTTP access, search cache, and persistent quota accounting."""
import asyncio
import json
import logging
import sqlite3
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Optional
from zoneinfo import ZoneInfo

import httpx

from .config import Settings

log = logging.getLogger(__name__)


class UpstreamError(Exception):
    """Expected failure; never carries a URL, credentials, or upstream body."""


class QuotaExceeded(UpstreamError):
    pass


class QuotaLedger:
    """Atomic per-day reservations shared by processes using the same DB.

    Separate search and metadata buckets match the current API quota model.
    Reservations are conservative: attempted/failed calls are never refunded.
    """
    def __init__(self, settings: Settings):
        self.limits = {"search": settings.daily_search_calls, "videos": settings.daily_metadata_calls}
        if settings.quota_db != ":memory:":
            Path(settings.quota_db).parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(settings.quota_db, timeout=0.1)
        self.db.execute("CREATE TABLE IF NOT EXISTS quota (day TEXT, bucket TEXT, used INTEGER, PRIMARY KEY(day, bucket))")
        self.db.commit()

    @staticmethod
    def day():
        return datetime.now(ZoneInfo("America/Los_Angeles")).date().isoformat()

    def reserve(self, bucket: str):
        day = self.day()
        try:
            with self.db:
                self.db.execute("INSERT OR IGNORE INTO quota VALUES (?, ?, 0)", (day, bucket))
                result = self.db.execute("UPDATE quota SET used=used+1 WHERE day=? AND bucket=? AND used<?", (day, bucket, self.limits[bucket]))
                if result.rowcount != 1:
                    raise QuotaExceeded("local daily quota exhausted")
                self.db.execute("DELETE FROM quota WHERE day < ?", (day,))
        except sqlite3.Error:
            raise QuotaExceeded("quota ledger unavailable") from None

    def exhaust(self, bucket: str):
        try:
            with self.db:
                self.db.execute("INSERT OR REPLACE INTO quota VALUES (?, ?, ?)", (self.day(), bucket, self.limits[bucket]))
        except sqlite3.Error:
            log.warning("quota_ledger_write_failed")

    def close(self):
        self.db.close()


@dataclass
class RequestBudget:
    end: float
    max_search_calls: int
    search_calls: int = 0
    metadata_calls: int = 0
    blocked: set = field(default_factory=set)

    def remaining(self):
        return max(0.0, self.end - time.monotonic())

    def reserve(self, bucket):
        if bucket in self.blocked:
            raise QuotaExceeded("API bucket unavailable")
        if self.remaining() <= 0:
            raise UpstreamError("deadline exhausted")
        if bucket == "search":
            if self.search_calls >= self.max_search_calls:
                raise QuotaExceeded("request search limit reached")
            self.search_calls += 1
        else:
            self.metadata_calls += 1


class YouTubeClient:
    def __init__(self, settings: Settings, client: httpx.AsyncClient, ledger: QuotaLedger):
        self.settings = settings
        self.client = client
        self.ledger = ledger
        self.slots = asyncio.Semaphore(settings.http_concurrency)
        self.cache = OrderedDict()

    async def get(self, url: str, budget: RequestBudget, **kwargs):
        async def request():
            async with self.slots:
                timeout = min(self.settings.request_timeout_seconds, budget.remaining())
                if timeout <= 0:
                    raise UpstreamError("deadline exhausted")
                return await self.client.get(url, timeout=timeout, **kwargs)
        # Includes time waiting for a shared HTTP slot and all HTTP phases.
        return await asyncio.wait_for(request(), timeout=budget.remaining())

    async def api(self, endpoint: str, params: dict, budget: RequestBudget):
        for attempt in range(2):
            budget.reserve(endpoint)
            try:
                self.ledger.reserve(endpoint)
            except QuotaExceeded:
                budget.blocked.add(endpoint)
                raise
            try:
                response = await self.get(
                    f"https://www.googleapis.com/youtube/v3/{endpoint}", budget,
                    params=params, headers={"X-Goog-Api-Key": self.settings.api_key},
                )
            except (httpx.HTTPError, asyncio.TimeoutError):
                # No transport retry: outages shouldn't consume search quota twice.
                raise UpstreamError("upstream transport failure") from None
            if response.status_code == 403:
                try:
                    reasons = {e.get("reason") for e in response.json().get("error", {}).get("errors", [])}
                except (ValueError, AttributeError, TypeError):
                    reasons = set()
                if reasons & {"quotaExceeded", "dailyLimitExceeded", "dailyLimitExceededUnreg"}:
                    self.ledger.exhaust(endpoint)
                    budget.blocked.add(endpoint)
                    raise QuotaExceeded("upstream quota exhausted")
                budget.blocked.update({"search", "videos"})
                raise UpstreamError("upstream access denied")
            if response.status_code == 429 or response.status_code >= 500:
                try:
                    delay = max(0.25, float(response.headers.get("Retry-After", "0.25")))
                except ValueError:
                    try:
                        until = parsedate_to_datetime(response.headers["Retry-After"])
                        delay = max(0.25, (until - datetime.now(timezone.utc)).total_seconds())
                    except (ValueError, TypeError, KeyError, OverflowError):
                        delay = 1.0
                if attempt == 0 and delay <= 2 and budget.remaining() > delay + 1:
                    await asyncio.sleep(delay)
                    continue
                raise UpstreamError("upstream temporarily unavailable")
            if response.status_code != 200:
                raise UpstreamError("upstream request rejected")
            try:
                data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get("items"), list):
                    raise ValueError()
                return data
            except (ValueError, json.JSONDecodeError):
                raise UpstreamError("invalid API response") from None
        raise UpstreamError("retry limit reached")

    async def search(self, query: str, budget: RequestBudget, page: Optional[str] = None,
                     max_results: Optional[int] = None):
        page_size = max_results or self.settings.search_results
        key = (query, page, page_size)
        cached = self.cache.get(key)
        if cached and cached[0] > time.monotonic():
            self.cache.move_to_end(key)
            return cached[1]
        params = {"part": "snippet", "q": query, "type": "video", "order": "relevance",
                  "videoDuration": "short", "videoCaption": "closedCaption",
                  "relevanceLanguage": "en",
                  "maxResults": page_size,
                  "fields": "items(id/videoId),nextPageToken"}
        if page:
            params["pageToken"] = page
        data = await self.api("search", params, budget)
        self.cache[key] = (time.monotonic() + self.settings.search_cache_seconds, data)
        self.cache.move_to_end(key)
        while len(self.cache) > 256:
            self.cache.popitem(last=False)
        return data

    async def videos(self, ids, budget: RequestBudget):
        if not 1 <= len(ids) <= 50:
            raise ValueError("videos.list requires 1–50 IDs per batch")
        return await self.api("videos", {
            "part": "snippet,contentDetails,status", "id": ",".join(ids),
            "fields": "items(id,snippet(title,description,tags,channelId,liveBroadcastContent,defaultAudioLanguage),contentDetails(duration,caption),status(privacyStatus,uploadStatus))",
        }, budget)
