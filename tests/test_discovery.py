import asyncio
import time
import unittest
from dataclasses import replace
from tempfile import TemporaryDirectory

import httpx
from fastapi.testclient import TestClient

from shorts_discovery.config import Settings
from shorts_discovery.pipeline import DiscoveryService
from shorts_discovery.planning import make_plan, rank, relevance
from shorts_discovery.verification import duration_seconds, eligible_metadata, verified_page
from shorts_discovery.youtube import QuotaExceeded, QuotaLedger, RequestBudget, UpstreamError
from tests.fakes import FakeYouTube, page, vid, video


PROMPT = "8th grade algebra simplification of expressions"


def settings(**kwargs):
    return Settings(api_key="test-secret-never-in-urls", quota_db=":memory:", **kwargs)


class PlanningTests(unittest.TestCase):
    def test_specific_concepts_and_level(self):
        plan = make_plan(PROMPT)
        self.assertEqual(plan.level, "8th grade")
        self.assertIn("simplify", plan.concepts)
        self.assertEqual(len(plan.queries), 4)
        self.assertTrue(any("combining like terms" in q for q in plan.queries))
        self.assertTrue(any("distributive property" in q for q in plan.queries))
        self.assertTrue(all("algebra" in q and "8th grade" in q for q in plan.expansions))

    def test_broad_topic_subtopic_diversity(self):
        plan = make_plan("Math")
        self.assertTrue(plan.broad)
        self.assertEqual(len(plan.subtopics), 4)
        self.assertEqual(len(set(plan.queries)), 4)
        self.assertGreater(relevance(plan, video(0, "Geometry triangles")), 0)
        self.assertGreater(relevance(plan, video(0, "Algebra equation")), 0)
        self.assertEqual(relevance(plan, video(0, "Cooking spaghetti")), 0)

    def test_specific_beats_generic_and_wrong_topic(self):
        plan = make_plan(PROMPT)
        candidates = [video(0, "Fun mathematics"), video(1, "Simplifying algebraic expressions"),
                      video(2, "Cooking"), video(3, "Combining like terms"), video(4, "8th grade algebra history")]
        ranked = list(rank(plan, candidates))
        self.assertEqual({v["id"] for v in ranked}, {vid(1), vid(3)})
        self.assertEqual(ranked[0]["id"], vid(1))

    def test_graph_and_arbitrary_paragraph(self):
        plan = make_plan("Introduction to graph theory, vertices, edges, and applications")
        self.assertTrue(any("applications" in q for q in plan.queries))
        self.assertGreater(relevance(plan, video(0, "Graph theory vertices and edges applications")), 0)
        self.assertEqual(relevance(plan, video(0, "Graph a linear equation")), 0)
        other = make_plan("Please explain photosynthesis with sunlight, chlorophyll and glucose for middle school learners.")
        self.assertIn("photosynthesis", other.topic)
        self.assertEqual(other.level, "middle school")
        self.assertTrue(all("photosynthesis" in q for q in other.queries))

    def test_invalid_prompt(self):
        for prompt in ("", "  ", "a" * 4001, "please show me videos", "8th grade"):
            with self.subTest(prompt=prompt[:20]), self.assertRaises(ValueError):
                make_plan(prompt)


class VerificationTests(unittest.TestCase):
    def test_default_audio_must_be_explicitly_english(self):
        for language in ("en", "en-US", "en-GB", "en-IN", "EN-us"):
            v = video(0)
            v["snippet"]["defaultAudioLanguage"] = language
            self.assertTrue(eligible_metadata(v))
        for language in (None, "", "hi", "es", "en_US", "english", "enough", "en-", True, [], 123):
            v = video(0)
            v["snippet"]["defaultAudioLanguage"] = language
            v["snippet"]["defaultLanguage"] = "en"
            self.assertFalse(eligible_metadata(v))
        v = video(0)
        del v["snippet"]["defaultAudioLanguage"]
        v["snippet"]["defaultLanguage"] = "en"
        self.assertFalse(eligible_metadata(v))

    def test_caption_flag_is_mandatory_and_exact(self):
        for caption in ("false", None, True, "True", "", 1):
            self.assertFalse(eligible_metadata(video(0, caption=caption)))
        missing = video(0)
        del missing["contentDetails"]["caption"]
        self.assertFalse(eligible_metadata(missing))
        self.assertTrue(eligible_metadata(video(0)))

    def test_duration_privacy_and_status(self):
        self.assertEqual(duration_seconds("PT3M"), 180)
        self.assertEqual(duration_seconds("PT0.5S"), 0.5)
        for duration in ("PT3M0.1S", "PT4M", "PT0S", "P", "PT", "bad", None):
            v = video(0)
            v["contentDetails"]["duration"] = duration
            self.assertFalse(eligible_metadata(v))
        for status in ({}, {"privacyStatus": "private", "uploadStatus": "processed"}, {"privacyStatus": "public", "uploadStatus": "failed"}):
            v = video(0)
            v["status"] = status
            self.assertFalse(eligible_metadata(v))

    def test_malformed_metadata_fails_closed(self):
        for part in ("snippet", "contentDetails", "status"):
            for value in (None, [], "invalid", 123):
                v = video(0)
                v[part] = value
                self.assertFalse(eligible_metadata(v))

    def test_short_page_evidence(self):
        video_id = vid(0)
        url = f"https://www.youtube.com/shorts/{video_id}"
        self.assertTrue(verified_page(page(video_id), url, video_id))
        for html, final in (
            (page(video_id, canonical=f"https://www.youtube.com/watch?v={video_id}"), url),
            (page(video_id), f"https://www.youtube.com/watch?v={video_id}"),
            (page(video_id, player_id=vid(1)), url),
            (page(video_id, playable=False), url),
            ("<html>Consent required #shorts</html>", url),
            (page(video_id), f"https://consent.youtube.com/shorts/{video_id}"),
            (f'<link rel="canonical" href="{url}">', url),
            ('<link rel><link rel="canonical" href="https://[broken">', url),
        ):
            self.assertFalse(verified_page(html, final, video_id))


class DiscoveryTests(unittest.IsolatedAsyncioTestCase):
    async def run_discovery(self, fake, prompt=PROMPT, config=None, count=10):
        async with DiscoveryService(config or settings(), transport=httpx.MockTransport(fake)) as service:
            return await service.discover(prompt, count=count)

    async def test_hundred_results_expand_and_keep_verification_mandatory(self):
        prompt = "calculus concepts review"
        plan = make_plan(prompt)
        queries = list(plan.queries) + list(plan.expansions)
        fake = FakeYouTube([video(i, "Calculus derivatives integrals review", caption="false" if i < 20 else "true") for i in range(200)])
        for i in range(20, 30):
            fake.pages[vid(i)] = page(vid(i), canonical=f"https://www.youtube.com/watch?v={vid(i)}")
        def ids(request):
            start = (queries.index(request.url.params["q"]) // 4) * 50
            return [vid(i) for i in range(start, start + 50)]
        fake.search_ids = ids
        urls = await self.run_discovery(fake, prompt, count=100)
        self.assertEqual(len(urls), 100)
        self.assertEqual(len(set(urls)), 100)
        self.assertTrue(all(url.rsplit("/", 1)[-1] not in {vid(i) for i in range(30)} for url in urls))
        self.assertEqual(fake.calls["search"], 12)
        self.assertTrue(all(r.url.params["maxResults"] == "50" for r in fake.requests if r.url.path.endswith("/search")))

    async def test_large_request_returns_only_available_results(self):
        fake = FakeYouTube([video(i, "Calculus integrals") for i in range(17)])
        self.assertEqual(len(await self.run_discovery(fake, "calculus concepts review", count=100)), 17)

    async def test_invalid_counts(self):
        async with DiscoveryService(settings(), transport=httpx.MockTransport(FakeYouTube())) as service:
            for count in (0, 101, True, 10.5, "100"):
                with self.subTest(count=count), self.assertRaises(ValueError):
                    await service.discover(PROMPT, count=count)

    async def test_large_request_paginates_within_budget(self):
        fake = FakeYouTube([video(i) for i in range(200)])
        async def handler(request):
            response = await fake(request)
            if request.url.path.endswith("/search"):
                offset = int(request.url.params.get("pageToken", "0"))
                return httpx.Response(200, json={"items": [{"id": {"videoId": vid(i)}} for i in range(offset, offset + 50)],
                                                "nextPageToken": str(offset + 50)})
            return response
        async with DiscoveryService(settings(), transport=httpx.MockTransport(handler)) as service:
            self.assertEqual(len(await service.discover(PROMPT, count=100)), 100)
        self.assertTrue(any("pageToken" in r.url.params for r in fake.requests))
        self.assertLessEqual(fake.calls["search"], 20)

    async def test_ten_unique_and_all_search_filters(self):
        fake = FakeYouTube()
        urls = await self.run_discovery(fake)
        self.assertEqual(len(urls), 10)
        self.assertEqual(len(set(urls)), 10)
        self.assertEqual(fake.calls["search"], 4)
        self.assertEqual(fake.calls["videos"], 1)
        for request in fake.requests:
            self.assertNotIn("test-secret", str(request.url))
            if request.url.path.endswith("/search"):
                self.assertEqual(request.url.params["videoCaption"], "closedCaption")
                self.assertEqual(request.url.params["videoDuration"], "short")
                self.assertEqual(request.url.params["type"], "video")
                self.assertEqual(request.url.params["relevanceLanguage"], "en")
            if request.url.path.endswith("/videos"):
                self.assertIn("contentDetails", request.url.params["part"])
                self.assertIn("defaultAudioLanguage", request.url.params["fields"])

    async def test_english_titles_and_captions_do_not_override_other_audio(self):
        videos = [video(i, "Calculus derivatives review") for i in range(6)]
        for v, language in zip(videos, ("en-US", "en-IN", "hi", "es", None, "")):
            v["snippet"]["defaultAudioLanguage"] = language
            v["snippet"]["defaultLanguage"] = "en"
        fake = FakeYouTube(videos)
        urls = await self.run_discovery(fake, "calculus concepts review", count=100)
        self.assertEqual(set(urls), {f"https://www.youtube.com/shorts/{vid(i)}" for i in (0, 1)})
        self.assertEqual(fake.calls["shorts"], 2)

    async def test_missing_false_unknown_captions_and_deleted(self):
        videos = [video(i, caption=caption) for i, caption in enumerate(("true", "false", None, True, "True"))]
        missing = video(5)
        del missing["contentDetails"]["caption"]
        fake = FakeYouTube(videos + [missing, video(6)])
        fake.omit_ids.add(vid(6))
        self.assertEqual(await self.run_discovery(fake), [f"https://www.youtube.com/shorts/{vid(0)}"])
        self.assertEqual(fake.calls["shorts"], 1)
        self.assertEqual(fake.calls["search"], 8)

    async def test_shorts_page_unknown_regular_private_are_excluded(self):
        fake = FakeYouTube([video(i) for i in range(5)])
        fake.pages[vid(0)] = page(vid(0), canonical=f"https://www.youtube.com/watch?v={vid(0)}")
        fake.pages[vid(1)] = httpx.Response(404)
        fake.pages[vid(2)] = page(vid(2), playable=False)
        fake.pages[vid(3)] = "consent page"
        self.assertEqual(await self.run_discovery(fake), [f"https://www.youtube.com/shorts/{vid(4)}"])

    async def test_auto_expansion_and_deduplication(self):
        fake = FakeYouTube()
        initial = set(make_plan(PROMPT).queries)
        fake.search_ids = lambda request: [vid(0)] * 4 if request.url.params["q"] in initial else [vid(i) for i in range(20)]
        urls = await self.run_discovery(fake)
        self.assertEqual(len(urls), 10)
        self.assertEqual(fake.calls["search"], 8)
        self.assertEqual(fake.calls["videos"], 2)
        self.assertEqual(sum(r.url.path.endswith("/" + vid(0)) for r in fake.requests), 1)

    async def test_empty_and_insufficient(self):
        self.assertEqual(await self.run_discovery(FakeYouTube([])), [])
        urls = await self.run_discovery(FakeYouTube([video(0), video(1)]))
        self.assertEqual(len(urls), 2)

    async def test_broad_and_specific_topics(self):
        fake = FakeYouTube([video(i, title) for i, title in enumerate(("Algebra equation", "Geometry triangle", "Math fractions", "Probability dice", "Cooking pasta"))])
        self.assertEqual(len(await self.run_discovery(fake, "Math")), 4)
        fake = FakeYouTube([video(0, "Graph theory vertices edges applications"), video(1, "Draw a graph linear equation")])
        self.assertEqual(len(await self.run_discovery(fake, "Introduction to graph theory, vertices, edges, and applications")), 1)

    async def test_metadata_batched_by_fifty(self):
        fake = FakeYouTube([video(i) for i in range(125)])
        await self.run_discovery(fake)
        calls = [r for r in fake.requests if r.url.path.endswith("/videos")]
        self.assertEqual(len(calls), 3)
        self.assertTrue(all(len(r.url.params["id"].split(",")) <= 50 for r in calls))

    async def test_deadline_cancels_stalled_searches(self):
        fake = FakeYouTube(delay=1)
        start = time.monotonic()
        result = await self.run_discovery(fake, config=settings(deadline_seconds=0.1, request_timeout_seconds=0.05))
        self.assertEqual(result, [])
        self.assertLess(time.monotonic() - start, 0.4)
        self.assertEqual(fake.active, 0)

    async def test_partial_results_survive_deadline(self):
        fake = FakeYouTube([video(i) for i in range(12)])
        fake.short_delays = {vid(i): 1 for i in range(3, 12)}
        result = await self.run_discovery(fake, config=settings(deadline_seconds=0.1, request_timeout_seconds=0.05))
        self.assertEqual(len(result), 3)
        self.assertEqual(fake.active, 0)

    async def test_cancellation_propagates_and_releases_capacity(self):
        fake = FakeYouTube(delay=1)
        async with DiscoveryService(settings(), transport=httpx.MockTransport(fake)) as service:
            task = asyncio.create_task(service.discover(PROMPT))
            await asyncio.sleep(0.01)
            task.cancel()
            with self.assertRaises(asyncio.CancelledError):
                await task
            self.assertEqual(service.active, 0)
            self.assertEqual(fake.active, 0)

    async def test_search_cache_never_caches_caption_confirmation(self):
        fake = FakeYouTube()
        async with DiscoveryService(settings(), transport=httpx.MockTransport(fake)) as service:
            self.assertEqual(len(await service.discover(PROMPT)), 10)
            for v in fake.videos:
                v["contentDetails"]["caption"] = "false"
            self.assertEqual(await service.discover(PROMPT), [])
            # Four original queries cached; four expansion calls made on second run.
            self.assertEqual(fake.calls["search"], 8)
            self.assertEqual(fake.calls["videos"], 2)

    async def test_quota_exhaustion_fails_closed(self):
        fake = FakeYouTube()
        fake.search_status = 403
        self.assertEqual(await self.run_discovery(fake), [])
        self.assertEqual(fake.calls["shorts"], 0)
        fake = FakeYouTube()
        fake.metadata_status = 403
        self.assertEqual(await self.run_discovery(fake), [])
        self.assertEqual(fake.calls["shorts"], 0)

    async def test_daily_budget_caps_calls(self):
        fake = FakeYouTube([])
        await self.run_discovery(fake, config=settings(daily_search_calls=2))
        self.assertEqual(fake.calls["search"], 2)

    async def test_capacity_has_no_unbounded_queue(self):
        fake = FakeYouTube(delay=0.1)
        async with DiscoveryService(settings(max_concurrent_requests=1), transport=httpx.MockTransport(fake)) as service:
            first = asyncio.create_task(service.discover(PROMPT))
            await asyncio.sleep(0.01)
            start = time.monotonic()
            self.assertEqual(await service.discover(PROMPT), [])
            self.assertLess(time.monotonic() - start, 0.05)
            self.assertEqual(len(await first), 10)

    async def test_concurrency_performance_under_30_seconds(self):
        fake = FakeYouTube(delay=0.15)
        start = time.monotonic()
        result = await self.run_discovery(fake)
        elapsed = time.monotonic() - start
        self.assertEqual(len(result), 10)
        self.assertGreaterEqual(fake.max_active, 4)
        # Three concurrent stages take ~0.45 s; serial requests take >2.5 s.
        self.assertLess(elapsed, 1.5)
        self.assertLess(elapsed, 30)


class QuotaTests(unittest.TestCase):
    def test_persistent_ledger_and_separate_buckets(self):
        with TemporaryDirectory() as directory:
            config = replace(settings(daily_search_calls=1), quota_db=directory + "/quota.db")
            ledger = QuotaLedger(config)
            ledger.reserve("search")
            ledger.reserve("videos")
            ledger.close()
            reopened = QuotaLedger(config)
            with self.assertRaises(QuotaExceeded):
                reopened.reserve("search")
            reopened.reserve("videos")
            reopened.close()


class HttpErrorTests(unittest.IsolatedAsyncioTestCase):
    async def test_server_error_retried_once_and_charged(self):
        count = 0

        async def handler(request):
            nonlocal count
            count += 1
            return httpx.Response(503 if count == 1 else 200, json={"items": []})

        async with DiscoveryService(settings(), transport=httpx.MockTransport(handler)) as service:
            budget = RequestBudget(time.monotonic() + 3, 8)
            result = await service.youtube.search("math shorts", budget)
            self.assertEqual(result, {"items": []})
            self.assertEqual(count, 2)
            self.assertEqual(budget.search_calls, 2)

    async def test_rate_limit_long_retry_after_is_not_retried(self):
        count = 0

        async def handler(request):
            nonlocal count
            count += 1
            return httpx.Response(429, headers={"Retry-After": "120"})

        async with DiscoveryService(settings(), transport=httpx.MockTransport(handler)) as service:
            start = time.monotonic()
            with self.assertRaises(UpstreamError):
                await service.youtube.search("math shorts", RequestBudget(start + 3, 8))
            self.assertEqual(count, 1)
            self.assertLess(time.monotonic() - start, 0.5)

    async def test_malformed_json_and_transport_error_fail_closed(self):
        for mode in ("json", "transport"):
            async def handler(request):
                if mode == "transport":
                    raise httpx.ConnectError("private sensitive upstream text", request=request)
                return httpx.Response(200, text="not json")

            async with DiscoveryService(settings(), transport=httpx.MockTransport(handler)) as service:
                with self.assertRaises(UpstreamError) as caught:
                    await service.youtube.search("math shorts", RequestBudget(time.monotonic() + 3, 8))
                self.assertNotIn("sensitive", str(caught.exception))


class ApiTests(unittest.TestCase):
    def test_endpoint_returns_only_array_and_rejects_invalid_input(self):
        from shorts_discovery.api import app

        class Stub:
            async def discover(self, prompt, count=10):
                if not prompt.strip():
                    raise ValueError()
                return [f"https://www.youtube.com/shorts/{vid(i)}" for i in range(count)]

        # Avoid lifespan: inject a service, no real key/network needed.
        app.state.discovery = Stub()
        client = TestClient(app)
        response = client.post("/discover", json={"prompt": PROMPT})
        self.assertEqual(response.status_code, 200)
        self.assertIsInstance(response.json(), list)
        self.assertIn("X-Discovery-Elapsed-Ms", response.headers)
        self.assertEqual(len(client.post("/discover", json={"prompt": "calculus concepts review", "count": 100}).json()), 100)
        for payload in ({}, {"prompt": 123}, {"prompt": " "}, {"prompt": "x" * 4001},
                        {"prompt": PROMPT, "count": 101}, {"prompt": PROMPT, "count": True}, {"prompt": PROMPT, "count": "100"}):
            response = client.post("/discover", json=payload)
            self.assertEqual(response.status_code, 422)
            self.assertEqual(response.json(), [])


if __name__ == "__main__":
    unittest.main()
