import asyncio
import logging
import time
from typing import List, Optional

import httpx

from .config import Settings
from .planning import make_plan, rank
from .verification import VIDEO_ID, ShortsVerifier, eligible_metadata
from .youtube import QuotaLedger, RequestBudget, UpstreamError, YouTubeClient

log = logging.getLogger(__name__)


class DiscoveryService:
    """Reuse as an async context manager for connection pooling and search caching."""
    def __init__(self, settings: Settings, transport: Optional[httpx.AsyncBaseTransport] = None):
        self.settings = settings
        self.http = httpx.AsyncClient(transport=transport, limits=httpx.Limits(max_connections=settings.http_concurrency),
                                      max_redirects=3, trust_env=False)
        self.ledger = QuotaLedger(settings)
        self.youtube = YouTubeClient(settings, self.http, self.ledger)
        self.verifier = ShortsVerifier(self.youtube)
        self.active = 0

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.http.aclose()
        self.ledger.close()

    async def discover(self, prompt: str, count: int = 10) -> List[str]:
        if not isinstance(prompt, str):
            raise ValueError("prompt must be a string")
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100:
            raise ValueError("count must be an integer between 1 and 100")
        plan = make_plan(prompt)
        # Do not queue requests behind another request's 28-second deadline.
        if self.active >= self.settings.max_concurrent_requests:
            log.warning("discovery_capacity_exceeded")
            return []
        self.active += 1
        start = time.monotonic()
        search_limit = self.settings.large_request_search_calls if count > 10 else self.settings.max_search_calls
        verification_limit = self.settings.large_request_verification_limit if count > 10 else self.settings.verification_limit
        page_size = 50 if count > 10 else self.settings.search_results
        budget = RequestBudget(start + self.settings.deadline_seconds, search_limit)
        accepted = {}
        seen = set()
        checked = set()

        async def safe_search(query, page=None):
            try:
                return await self.youtube.search(query, budget, page, max_results=page_size)
            except UpstreamError as exc:
                log.warning("search_failed reason=%s", exc)
                return {"items": []}

        async def metadata(ids):
            try:
                result = await self.youtube.videos(ids, budget)
                return [v for v in result["items"] if isinstance(v, dict) and v.get("id") in ids and eligible_metadata(v)]
            except UpstreamError as exc:
                log.warning("metadata_failed reason=%s", exc)
                return []

        async def verify(video):
            if await self.verifier.verify(video["id"], budget):
                # Commit each success immediately so cancellation keeps partial results.
                accepted[video["id"]] = video

        async def process(responses):
            ids = []
            for response in responses:
                for item in response.get("items", []):
                    if not isinstance(item, dict) or not isinstance(item.get("id"), dict):
                        continue
                    video_id = item["id"].get("videoId", "")
                    if isinstance(video_id, str) and VIDEO_ID.fullmatch(video_id) and video_id not in seen:
                        seen.add(video_id)
                        ids.append(video_id)
            batches = await asyncio.gather(*(metadata(ids[i:i + 50]) for i in range(0, len(ids), 50)))
            candidates = list(rank(plan, [v for batch in batches for v in batch]))
            # Refill slots as each check completes; one slow page must not stall
            # the rest of a batch. Bound both outstanding tasks and total checks.
            candidates = iter(candidates)
            pending = set()
            exhausted = False
            try:
                while len(accepted) < count:
                    concurrency = min(self.settings.http_concurrency, max(12, count - len(accepted)))
                    while not exhausted and len(pending) < concurrency and len(checked) < verification_limit:
                        video = next(candidates, None)
                        if video is None:
                            exhausted = True
                            break
                        if video["id"] not in checked:
                            checked.add(video["id"])
                            pending.add(asyncio.create_task(verify(video)))
                    if not pending:
                        break
                    done, pending = await asyncio.wait(pending, return_when=asyncio.FIRST_COMPLETED)
                    for task in done:
                        task.result()
            finally:
                for task in pending:
                    task.cancel()
                await asyncio.gather(*pending, return_exceptions=True)

        def can_continue():
            return (len(accepted) < count and budget.remaining() > 1
                    and "videos" not in budget.blocked and len(checked) < verification_limit)

        async def work():
            queries = list(plan.queries)
            responses = await asyncio.gather(*(safe_search(q) for q in queries))
            await process(responses)
            if not can_continue():
                return
            # Automatic reformulation preserves concepts and educational level.
            pages = [(q, r["nextPageToken"]) for q, r in zip(queries, responses) if r.get("nextPageToken")]
            expansions = list(plan.expansions)
            while can_continue() and (expansions or pages):
                available = max(0, search_limit - budget.search_calls)
                if not available or "search" in budget.blocked:
                    break
                jobs = []
                if expansions:
                    jobs = [(q, None) for q in expansions[:min(4, available)]]
                    del expansions[:len(jobs)]
                else:
                    jobs = pages[:min(4, available)]
                    del pages[:len(jobs)]
                batch = await asyncio.gather(*(safe_search(q, p) for q, p in jobs))
                pages.extend((q, response["nextPageToken"]) for (q, _), response in zip(jobs, batch) if response.get("nextPageToken"))
                await process(batch)

        try:
            await asyncio.wait_for(work(), timeout=budget.remaining())
        except asyncio.TimeoutError:
            log.info("discovery_deadline_reached")
        finally:
            self.active -= 1
        results = [f"https://www.youtube.com/shorts/{v['id']}" for v in list(rank(plan, list(accepted.values())))[:count]]
        log.info("discovery_complete results=%d elapsed_ms=%d search_calls=%d metadata_calls=%d verified_candidates=%d",
                 len(results), (time.monotonic() - start) * 1000, budget.search_calls, budget.metadata_calls, len(checked))
        return results


async def discover_shorts(prompt: str, settings: Optional[Settings] = None, count: int = 10) -> List[str]:
    """Convenience entry point. Reuse DiscoveryService for multiple requests."""
    async with DiscoveryService(settings or Settings.from_env()) as service:
        return await service.discover(prompt, count=count)
