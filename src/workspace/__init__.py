from __future__ import annotations

import argparse
import json
import os
from decimal import Decimal
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from apify_client import ApifyClient

ACTOR_ID = "johnvc/youtubetranscripts"
MAX_URLS_PER_RUN = 100


def video_id(url: str) -> str | None:
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower().removeprefix("www.")
    parts = [part for part in parsed.path.split("/") if part]
    if host == "youtu.be" and parts:
        return parts[0]
    if host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
        if parsed.path == "/watch":
            return parse_qs(parsed.query).get("v", [None])[0]
        if len(parts) >= 2 and parts[0] in {"shorts", "embed", "live", "v"}:
            return parts[1]
    return None


def load_links(path: Path) -> list[str]:
    data = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(data, list) or not data:
        raise ValueError(f"{path} must contain a non-empty JSON array of YouTube URLs")
    if any(not isinstance(url, str) or not video_id(url) for url in data):
        raise ValueError("Every input must be a supported YouTube video URL")
    return data


def load_token(token_file: Path) -> str:
    token = os.environ.get("APIFY_TOKEN", "").strip()
    if not token and token_file.is_file():
        token = token_file.read_text(encoding="utf-8").strip()
    if not token:
        raise ValueError("Set APIFY_TOKEN or provide a token file (default: api_token)")
    return token


def _result(url: str, item: dict | None) -> dict:
    if item is None:
        return {
            "url": url,
            "success": False,
            "transcript": None,
            "segments": [],
            "error": "Actor returned no result for this URL",
        }

    transcript = item.get("non_timestamped")
    segments = item.get("timestamped") or []
    success = item.get("success")
    if success is None:
        success = bool(transcript or segments)
    error = item.get("error_message") or item.get("error_type")
    if not error and isinstance(item.get("error"), str):
        error = item["error"]
    return {
        "url": url,
        "success": bool(success),
        "transcript": transcript,
        "segments": segments,
        "language": item.get("language"),
        "language_code": item.get("language_code"),
        "is_generated": item.get("is_generated"),
        "title": item.get("title"),
        "channel": item.get("channel_name"),
        "error": error,
    }


def _field(value: object, name: str, api_name: str | None = None):
    if isinstance(value, dict):
        return value.get(api_name or name, value.get(name))
    return getattr(value, name, None)


def records_from_run(client: ApifyClient, run: object, urls: list[str]) -> list[dict]:
    status = _field(run, "status")
    if status != "SUCCEEDED":
        message = _field(run, "status_message", "statusMessage") or "no status message"
        raise RuntimeError(f"Apify Actor run ended with {status or 'unknown'}: {message}")

    dataset_id = _field(run, "default_dataset_id", "defaultDatasetId")
    if not dataset_id:
        raise RuntimeError("Apify run succeeded without a result dataset")
    items = list(client.dataset(dataset_id).iterate_items())
    by_id = {}
    for item in items:
        key = item.get("video_id") or video_id(item.get("url", ""))
        if key:
            by_id[key] = item
    return [_result(url, by_id.get(video_id(url))) for url in urls]


def fetch_transcripts(
    urls: list[str], token: str, language: str = "en"
) -> list[dict]:
    client = ApifyClient(token=token)
    results: list[dict] = []

    for start in range(0, len(urls), MAX_URLS_PER_RUN):
        batch = urls[start : start + MAX_URLS_PER_RUN]
        run = client.actor(ACTOR_ID).call(
            run_input={
                "youtube_url": batch,
                "languages": [language],
                "include_metadata": True,
            },
            # This is a per-run billing cap; keep it in call options, not Actor input.
            max_total_charge_usd=Decimal("1.00"),
        )
        if not run:
            raise RuntimeError("Apify did not return a run record")
        results.extend(records_from_run(client, run, batch))

    return results


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Fetch YouTube video and Shorts transcripts through Apify."
    )
    parser.add_argument("--input", type=Path, default=Path("data/links.json"))
    parser.add_argument("--output", type=Path, default=Path("data/transcripts.json"))
    parser.add_argument("--token-file", type=Path, default=Path("api_token"))
    parser.add_argument("--language", default="en")
    args = parser.parse_args()

    try:
        urls = load_links(args.input)
        records = fetch_transcripts(urls, load_token(args.token_file), args.language)
        args.output.parent.mkdir(parents=True, exist_ok=True)
        temporary = args.output.with_suffix(args.output.suffix + ".tmp")
        temporary.write_text(
            json.dumps(records, ensure_ascii=False, indent=2) + "\n",
            encoding="utf-8",
        )
        temporary.replace(args.output)
        successful = sum(record["success"] for record in records)
        print(f"Wrote {len(records)} transcript records ({successful} successful) to {args.output}")
    except (OSError, ValueError, RuntimeError) as error:
        parser.exit(1, f"Error: {error}\n")
