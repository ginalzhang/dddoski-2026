# Offline performance results

Measured October 16, 2026 on the local macOS/Python 3.9.6 environment:

```sh
python -m unittest discover -s tests -v
python -m scripts.benchmark --runs 3 > benchmarks/offline.jsonl
```

All 29 tests passed. The nine cold-cache benchmark runs each returned ten URLs from synthetic HTTP fixtures. Each search, metadata, and Shorts-page request included 300 ms of simulated latency; four searches produced 100 unique candidates, requiring two concurrent metadata batches. The first verification wave checked twelve candidates concurrently.

| Measurement | Result |
| --- | --- |
| Mean | 0.949 seconds |
| p95 / maximum | 0.986 seconds |
| Runs within 30 seconds | 9 / 9 |
| Runs returning ten results | 9 / 9 |

Raw samples are in [offline.jsonl](offline.jsonl). Separate tests confirm deadline cancellation, retained partial results, upstream failures, and concurrency. These timings measure orchestration with simulated HTTP, not live YouTube behavior. No key was available for this initial ten-result benchmark. The subsequent live test below used a user-configured key.

## 100-result support and live calculus run

After adding configurable counts, expanded searches, pagination, a rolling verification pool, and mandatory English audio metadata, all **35 tests pass**, including 100-result discovery with caption and Shorts rejection, language rejection, count validation, and insufficient results. Large requests retain the 28-second deadline and use up to 24 shared HTTP slots.

The latest live input **`calculus concepts review`**, with `count=100`, returned **100 unique, caption-confirmed Shorts URLs with English-tagged default audio in 18.030 seconds**, using eight searches and seven metadata batches. It attempted 197 candidate page checks. Each included video passed the canonical Shorts route and playable-identity check and had an explicit English `snippet.defaultAudioLanguage` value. Missing and non-English audio languages were excluded even when titles were English. The URL array and run measurements below have been replaced with this English-filtered run. Language confirmation relies on YouTube's metadata declaration; no independent audio analysis was performed. This is one successful live measurement, not a guarantee of completeness or latency on future runs.

- [100 URLs as a JSON array](calculus-review-100.urls.json)
- [Live run measurements](calculus-review-100.run.json)
- [100-result simulated benchmark](offline-100.jsonl): three runs, 2.135 seconds mean and 2.143 seconds maximum, each returning 100 results with 300 ms simulated request latency.

To repeat the benchmark with your configured key, run `python -m scripts.benchmark --live --runs 1 --count 100`. This tests three topics and consumes up to 60 search calls; all daily and per-request caps still apply.

## Physics questions dataset

[physics-questions-100.urls.json](physics-questions-100.urls.json) contains a separate array of 100 unique, caption-confirmed Shorts with English-tagged default audio. Discovery started with `physics questions and worked solutions` (67 results in 17.761 seconds), then broadened to `physics questions` (100 results in 14.728 seconds). The verified pools were combined, deduplicated, and ranked to select 100. Total discovery execution time across both passes was 32.489 seconds. The existing calculus array was preserved.

[Physics run measurements](physics-questions-100.run.json) record each pass and the language-tag distribution. As with the calculus list, English confirmation relies on YouTube's declared default audio language, captions on its availability flag, and Shorts classification on canonical routing and matching playable identity.

## AP Chemistry dataset

[ap-chemistry-100.urls.json](ap-chemistry-100.urls.json) contains a separate array of 100 unique, caption-confirmed Shorts with English-tagged default audio and AP Chemistry references in their titles, descriptions, or tags. Discovery searched AP Chemistry topics including atomic structure, stoichiometry, equilibrium, acids and bases, thermodynamics, kinetics, bonding, electrochemistry, and solutions. The live run reached 100 results in 14.581 seconds using nine searches, six metadata batches, and 135 candidate page checks.

[AP Chemistry run measurements](ap-chemistry-100.run.json) record the counts and language-tag distribution. The same metadata and Shorts-page checks apply; course relevance is based on public metadata, not an independent review against the AP syllabus.
