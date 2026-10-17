"""Conservative Shorts verification; no media or captions are downloaded.

The Data API has no public isShort field. Require YouTube's canonical Shorts
route plus a matching playable player response. A 200, #shorts hashtag, short
duration, portrait thumbnail, or URL alone is never sufficient evidence.
"""
import asyncio
import json
import re
from html.parser import HTMLParser
from urllib.parse import urlparse

import httpx

from .youtube import RequestBudget, UpstreamError, YouTubeClient

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
DURATION = re.compile(r"^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?$")
ENGLISH_LANGUAGE = re.compile(r"en(?:-[a-z0-9]{2,8})*", re.IGNORECASE)


def english_audio(snippet: dict) -> bool:
    """Require an explicit English tag on the default spoken audio track.

    Titles, UI locale, metadata language and translated captions cannot prove
    audio language. Unknown/unset values are excluded, even if text is English.
    """
    language = snippet.get("defaultAudioLanguage")
    return isinstance(language, str) and ENGLISH_LANGUAGE.fullmatch(language) is not None


def duration_seconds(value):
    match = DURATION.fullmatch(value) if isinstance(value, str) else None
    if not match or not any(match.groups()):
        return None
    return sum(float(x or 0) * unit for x, unit in zip(match.groups(), (86400, 3600, 60, 1)))


def eligible_metadata(video: dict) -> bool:
    if not isinstance(video, dict) or not VIDEO_ID.fullmatch(str(video.get("id", ""))):
        return False
    details = video.get("contentDetails")
    status = video.get("status")
    snippet = video.get("snippet")
    if not all(isinstance(part, dict) for part in (details, status, snippet)):
        return False
    if not english_audio(snippet):
        return False
    if not isinstance(snippet.get("title"), str) or not isinstance(snippet.get("description", ""), str):
        return False
    if not isinstance(snippet.get("tags", []), list) or not all(isinstance(t, str) for t in snippet.get("tags", [])):
        return False
    # Deliberately strict: True, "True", false, missing and unknown all fail.
    if details.get("caption") != "true":
        return False
    seconds = duration_seconds(details.get("duration"))
    return (seconds is not None and 0 < seconds <= 180
            and status.get("privacyStatus") in ("public", "unlisted")
            and status.get("uploadStatus") == "processed"
            and snippet.get("liveBroadcastContent", "none") == "none")


def shorts_route(url: str, video_id: str) -> bool:
    if not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url)
        return (parsed.scheme == "https" and parsed.hostname in {"www.youtube.com", "youtube.com", "m.youtube.com"}
                and parsed.path.rstrip("/") == f"/shorts/{video_id}")
    except ValueError:
        return False


class PageEvidence(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.canonicals = []
        self.scripts = []
        self.script = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "link" and "canonical" in (attrs.get("rel") or "").lower().split():
            self.canonicals.append(attrs.get("href", ""))
        if tag == "script":
            self.script = []

    def handle_data(self, data):
        if self.script is not None:
            self.script.append(data)

    def handle_endtag(self, tag):
        if tag == "script" and self.script is not None:
            self.scripts.append("".join(self.script))
            self.script = None


def verified_page(html: str, final_url: str, video_id: str) -> bool:
    if not shorts_route(final_url, video_id):
        return False
    page = PageEvidence()
    try:
        page.feed(html)
    except (ValueError, AssertionError):
        return False
    # Reject a watch canonical even when /shorts/ returned HTTP 200.
    if not page.canonicals or not all(shorts_route(url, video_id) for url in page.canonicals):
        return False
    decoder = json.JSONDecoder()
    for script in page.scripts:
        # Parse actual script assignments, never a matching string in a title.
        for marker in re.finditer(r'(?:\b(?:var\s+)?ytInitialPlayerResponse|window\["ytInitialPlayerResponse"\])\s*=\s*', script):
            try:
                player, _ = decoder.raw_decode(script[marker.end():])
            except (ValueError, RecursionError):
                continue
            if not isinstance(player, dict):
                continue
            details = player.get("videoDetails")
            playability = player.get("playabilityStatus")
            if not isinstance(details, dict) or not isinstance(playability, dict):
                continue
            if (details.get("videoId") == video_id
                    and playability.get("status") == "OK"
                    and not details.get("isLiveContent", False)):
                return True
    return False


class ShortsVerifier:
    def __init__(self, youtube: YouTubeClient):
        self.youtube = youtube

    async def verify(self, video_id: str, budget: RequestBudget) -> bool:
        if not VIDEO_ID.fullmatch(video_id):
            return False
        try:
            response = await self.youtube.get(
                f"https://www.youtube.com/shorts/{video_id}", budget,
                params={"hl": "en"}, follow_redirects=True,
                headers={"User-Agent": "Mozilla/5.0 (compatible; ShortsDiscovery/0.1)", "Accept-Language": "en-US,en;q=0.9"},
            )
            if response.status_code != 200 or len(response.content) > 5_000_000:
                return False
            return verified_page(response.text, str(response.url), video_id)
        except (httpx.HTTPError, asyncio.TimeoutError, UpstreamError):
            return False
