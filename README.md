# YouTube Shorts transcript pipeline

Reads a JSON array of YouTube video/Shorts URLs, fetches captions with the Apify
Actor `johnvc/youtubetranscripts`, and writes one result per input URL to JSON.
The Actor returns transcripts only when YouTube captions are available; it does
not speech-to-text videos without captions.

## Run

The project uses `uv` and `apify-client`:

```bash
uv run workspace --input data/links.json --output data/transcripts.json
```

The token is read from `APIFY_TOKEN` first, then from `api_token` in the project
root. Keep the token private; `api_token` is git-ignored. To use another token
file or transcript language, pass `--token-file PATH` or `--language es`.

The Actor accepts up to 100 URLs per run. Larger input files are split into
batches. Each run has a $1 Apify charge cap; the cap is per run, not for the
entire input file. Successful transcripts currently cost about $0.00275 each
on the Free tier, plus small run/storage charges. Missing-caption results are
included as unsuccessful records rather than dropped.

Each output record preserves its input `url` and includes `success`, a plain
`transcript`, timestamped `segments`, language/video metadata, and an `error`
when no transcript is available. For example:

```json
[
  {
    "url": "https://youtube.com/shorts/VIDEO_ID",
    "success": true,
    "transcript": "Spoken words...",
    "segments": [{"text": "Spoken words...", "start": 0.0, "duration": 2.5}],
    "language": "English",
    "language_code": "en",
    "is_generated": true,
    "title": "Video title",
    "channel": "Channel name",
    "error": null
  }
]
```
