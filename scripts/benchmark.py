"""Run `python -m scripts.benchmark [--live] [--runs 3]` from the repo root."""
import argparse
import asyncio
import json
import logging
import math
import statistics
import time

import httpx

from shorts_discovery import DiscoveryService, Settings

PROMPTS = ("Math", "8th grade algebra simplification of expressions",
           "Introduction to graph theory, vertices, edges, and applications")


async def benchmark(live=False, runs=3, count=10):
    samples = []
    for iteration in range(runs):
        for prompt in PROMPTS:
            if live:
                config = Settings.from_env()
                transport = None
            else:
                from tests.fakes import FakeYouTube, video
                from shorts_discovery.planning import make_plan
                title = {PROMPTS[0]: "Math algebra geometry probability",
                         PROMPTS[1]: "8th grade simplifying algebraic expressions combining like terms",
                         PROMPTS[2]: "Graph theory vertices edges applications"}[prompt]
                fake = FakeYouTube([video(i, title) for i in range(100)], delay=0.3)
                queries = list(make_plan(prompt).queries)
                fake.search_ids = lambda request: [v["id"] for v in fake.videos[
                    queries.index(request.url.params["q"]) * 25:(queries.index(request.url.params["q"]) + 1) * 25]]
                config = Settings(api_key="benchmark-only", quota_db=":memory:")
                transport = httpx.MockTransport(fake)
            # Fresh service: cold search cache for every sample. Persistent live quota ledger.
            async with DiscoveryService(config, transport=transport) as service:
                start = time.monotonic()
                urls = await service.discover(prompt, count=count)
                seconds = time.monotonic() - start
            sample = {"prompt": prompt, "run": iteration + 1, "seconds": round(seconds, 3), "results": len(urls)}
            samples.append(sample)
            print(json.dumps(sample), flush=True)
    times = sorted(s["seconds"] for s in samples)
    summary = {"mode": "live" if live else "simulated HTTP (300 ms per request)", "samples": len(samples),
               "mean_seconds": round(statistics.mean(times), 3),
               "p95_seconds": times[max(0, math.ceil(len(times) * 0.95) - 1)],
               "max_seconds": max(times), "all_within_30_seconds": max(times) <= 30,
               "target_count": count, "all_reached_target": all(s["results"] == count for s in samples)}
    print(json.dumps(summary))
    return 0 if summary["all_within_30_seconds"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true", help="Consumes real YouTube API quota; requires YOUTUBE_API_KEY")
    parser.add_argument("--runs", type=int, default=3)
    parser.add_argument("--count", type=int, default=10, choices=range(1, 101), metavar="1-100")
    args = parser.parse_args()
    if args.runs < 1:
        parser.error("--runs must be positive")
    logging.basicConfig(level=logging.INFO)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    try:
        raise SystemExit(asyncio.run(benchmark(args.live, args.runs, args.count)))
    except ValueError as exc:
        parser.exit(2, str(exc) + "\n")
