# YouTube Shorts discovery

A Python 3.9+ backend accepting an educational topic, sentence, or paragraph and returning a JSON array of unique, relevant, captioned Shorts URLs whose default audio is explicitly tagged as English by YouTube. Request 1–100 results with `count`; the default remains ten. No frontend, transcription, audio processing, or caption downloads.

## Run

```sh
python3 -m venv .venv
source .venv/bin/activate
python -m pip install -r requirements.txt
```

In [Google Cloud Console](https://console.cloud.google.com/apis/library/youtube.googleapis.com), create/select a project, enable **YouTube Data API v3**, and create an API key. Restrict the key to that API and your server's IP addresses where appropriate. Public discovery needs an API key; OAuth is unnecessary.

```sh
export YOUTUBE_API_KEY='your-key'
python -m uvicorn shorts_discovery.api:app --host 127.0.0.1 --port 8000
```

Run commands from the repository root. `.env.example` lists optional configuration; it is documentation, not automatically loaded. If you copy it to `.env`, load it into your shell or deployment environment before starting. The server fails at startup with a configuration error if the key is missing.

```sh
curl --request POST http://127.0.0.1:8000/discover \
  --header 'Content-Type: application/json' \
  --data '{"prompt":"8th grade algebra simplification of expressions"}'
```

For 100 calculus videos:

```sh
curl --request POST http://127.0.0.1:8000/discover \
  --header 'Content-Type: application/json' \
  --data '{"prompt":"calculus concepts review","count":100}'
```

The response body is only a JSON array, for example `[]` when no candidates can be confirmed. Successful arrays contain up to the requested count of real URLs shaped as `https://www.youtube.com/shorts/<11-character-id>`. There is no metadata envelope. `X-Discovery-Elapsed-Ms` provides elapsed time without changing the body. Invalid input or a non-integer count outside 1–100 returns HTTP 422 with `[]`. The health endpoint is `GET /health`; interactive API documentation is `/docs`.

Callable entry point:

```python
import asyncio
import json
from shorts_discovery import discover_shorts

print(json.dumps(asyncio.run(discover_shorts("Discrete math"))))
# Or: asyncio.run(discover_shorts("calculus concepts review", count=100))
```

For repeated calls, reuse connections and the search cache:

```python
from shorts_discovery import DiscoveryService, Settings

async def discover_topics():
    async with DiscoveryService(Settings.from_env()) as service:
        return await service.discover("Introduction to graph theory, vertices, edges, and applications")
```

## Validation and relevance

1. Extract concepts and educational level using deterministic English text rules. Generate four targeted queries and execute them concurrently through `search.list`, always setting `type=video`, `videoDuration=short`, `videoCaption=closedCaption`, and `relevanceLanguage=en`.
2. Deduplicate IDs and fetch `videos.list` metadata in concurrent batches of up to 50, requesting `snippet,contentDetails,status`.
3. Require **`contentDetails.caption == "true"`** exactly. Missing, false, boolean, malformed, inaccessible, private, failed uploads, and unverified metadata are excluded. The duration must be positive and at most 180 seconds; duration alone never establishes Shorts status.
4. Rank by title, description, concept coverage, and grade match. Simplifying expressions expands to combining like terms and the distributive property; graph theory has related expansions. Calculus reviews expand across limits, derivatives, integrals, the chain rule, the fundamental theorem, and applications. Known broad domains use varied subtopics and a diversity penalty for similar titles. Other topics retain their extracted concepts. English lexical rules are intentionally transparent and have limited semantic and multilingual understanding; they do not guarantee human-level relevance for every paragraph.
5. Check the highest-ranked candidates against their YouTube Shorts pages, refilling a bounded pool as checks finish so a slow page does not stall the other checks. Require a final matching Shorts route, a matching canonical Shorts URL, and a matching `ytInitialPlayerResponse` with playability `OK`. A short duration, hashtag, HTTP 200, portrait thumbnail, or constructed `/shorts/` URL is insufficient.
6. If fewer than the requested count survive, automatically reformulate searches while preserving the topic and level. Paginate initial and expanded queries within the remaining call budget. Return only verified results, ranked and deduplicated, even when this is fewer than requested.

The [Data API video resource](https://developers.google.com/youtube/v3/docs/videos) exposes no public Shorts classification field. [The short-duration search filter](https://developers.google.com/youtube/v3/docs/search/list) covers videos under four minutes. [YouTube's current Shorts rules](https://support.google.com/youtube/answer/15424877?hl=en) depend on aspect ratio, upload date, and channel type; the required source dimensions are not available for arbitrary videos through public Data API access. This implementation therefore uses YouTube's own canonical Shorts routing plus playable video identity as conservative evidence, rather than inferring classification from duration or upload date.

**The page check is an undocumented integration, not an official Shorts verification API.** Consent pages, bot challenges, region/age restrictions, missing initial player data, and markup changes can reduce results to zero. It fails closed whenever evidence is absent or ambiguous; its output still needs live validation in your deployment region. Replace `ShortsVerifier` if YouTube introduces a supported public classification endpoint. No implementation can offer an official classification guarantee from the Data API alone.

Caption confirmation means the availability flag from YouTube at the time of the metadata request. It does not guarantee that another service can download captions. Playability checks reflect the backend's region and session; availability can change after discovery.

### English audio is mandatory

Every result must have `snippet.defaultAudioLanguage` set to `en` or a valid English variant such as `en-US`, `en-GB`, or `en-IN`. Missing, malformed, and non-English values are rejected before page checks, even when titles and descriptions are in English. `snippet.defaultLanguage` describes text metadata and is never used as a fallback. English captions or translated titles do not establish spoken language.

[YouTube documents `defaultAudioLanguage`](https://developers.google.com/youtube/v3/docs/videos#snippet.defaultAudioLanguage) as the language spoken in the default audio track. This is a metadata declaration, not an independent audit of the audio; no transcription or audio processing is performed. [The search language preference](https://developers.google.com/youtube/v3/docs/search/list#relevanceLanguage) can still return other languages, so it is only an initial preference and the metadata gate is mandatory. Unknown-language videos are excluded even if this prevents reaching the requested count. Caption availability remains a separate mandatory check; the availability flag does not specify the caption language.

## Time, failures, and quotas

The default overall work deadline is **28 seconds**, leaving room under the approximate 30-second target. Each HTTP operation has a five-second phase timeout and is also bounded by the overall remaining deadline. At the deadline, pending tasks are cancelled and completed verified results are retained. External cancellation propagates and releases capacity.

Search failures and metadata failures remove unverified candidates; unavailable Shorts pages reject the corresponding videos. HTTP 429 and 5xx responses can receive one bounded retry, honoring short `Retry-After` delays. Long retry delays are declined rather than exceeding the deadline. Transport errors and 403 responses are not retried. Error bodies and credential-bearing request objects are never logged by this code. Logs record counts, elapsed time, and sanitized failure reasons. Enable INFO logs in your deployment to collect these metrics.

As documented in Google's [quota calculator](https://developers.google.com/youtube/v3/determine_quota_cost) (checked October 16, 2026), the default allocation uses a separate bucket of 100 `search.list` calls per day and 10,000 units for other endpoints; `videos.list` costs one unit. Confirm your project's actual quotas in Cloud Console because allocations and policies can differ or change. This service defaults to 90 searches and 9,000 metadata calls per day, with atomic SQLite reservations and reset by Pacific calendar day. Failed attempts and retries consume reservations. Upstream daily-quota errors close that bucket locally until the next day.

Requests for up to ten videos permit at most eight outbound search attempts by default, including retries: four initial queries plus up to four reformulations, with 25 candidates per search and up to 100 page verifications. Larger requests use up to 20 searches, 50 candidates per search, and 400 verifications while keeping the same deadline. Set `YOUTUBE_LARGE_REQUEST_SEARCH_CALLS` (4–20) and `YOUTUBE_LARGE_REQUEST_VERIFICATION_LIMIT` (at least 100) to tune these large-request limits. Metadata calls remain batched at 50 IDs. All requests share the persistent daily caps. Quota use depends on overlap, retries, and expansion; do not increase local limits beyond the allocation in your Cloud project.

Only successful **search results** are cached (five minutes, maximum 256 entries). Metadata and Shorts checks are performed again for every discovery so caption availability is not taken from a stale result cache. There is no final-result cache.

The SQLite ledger persists in `.cache/quota.sqlite3` by default. Keep it on persistent local storage; all workers using the same key on one host should share that file. Separate hosts/containers need a shared atomic quota store before scaling, and this ledger cannot see other applications using the same Google project. Request admission defaults to four concurrent discoveries per worker, with at most 24 concurrent HTTP requests shared across them (`YOUTUBE_HTTP_CONCURRENCY`). Small discoveries use at most twelve concurrent page checks. Excess requests immediately return `[]` and log a capacity event. Place the service behind your normal authentication and request limits when exposing it publicly.

## Tests and performance

```sh
python -m unittest discover -s tests -v
python -m scripts.benchmark --runs 3
python -m scripts.benchmark --runs 1 --count 100
```

The offline tests exercise the complete HTTP flow with `httpx.MockTransport`: broad and specific topics, exact caption verification, mandatory English audio metadata (including regional variants, missing values, and misleading English titles), duplicates, insufficient/empty results, Shorts evidence, automatic expansion, inaccessible videos, batching, quotas, cache freshness, API schema, concurrent requests, cancellation, partial results, and deadline behavior. Fixtures use synthetic IDs only inside tests; production code never creates candidate IDs.

The offline benchmark uses 100 candidates and 300 ms of simulated network latency per HTTP call, with a cold cache for each of three topics. It prints result counts, elapsed times, p95, and whether each run meets the target. This measures orchestration; it does **not** establish live YouTube latency, result quality, or Shorts page compatibility.

Recorded local results and their limits are in [benchmarks/README.md](benchmarks/README.md).

After configuring a real key, run the same benchmark against YouTube:

```sh
python -m scripts.benchmark --live --runs 1
```

A live run consumes API quota (up to 24 search attempts for three topics at the default count, or 60 with `--count 100`). It prints measured counts and timings, never fabricates results, and may return fewer than requested. No live key is bundled. The benchmark's exit status checks the 30-second latency target; `all_reached_target` reports completeness separately so an empty fast response is visible.
