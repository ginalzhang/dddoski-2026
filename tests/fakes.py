import asyncio
import json
from collections import Counter

import httpx


def vid(n):
    return f"v{n:010d}"


def video(n, title="Simplifying algebraic expressions 8th grade", caption="true"):
    return {"id": vid(n), "snippet": {"title": title, "description": "", "channelId": "educator", "liveBroadcastContent": "none", "defaultAudioLanguage": "en"},
            "contentDetails": {"caption": caption, "duration": "PT45S"},
            "status": {"privacyStatus": "public", "uploadStatus": "processed"}}


def page(video_id, canonical=None, player_id=None, playable=True):
    canonical = canonical or f"https://www.youtube.com/shorts/{video_id}"
    player = {"videoDetails": {"videoId": player_id or video_id},
              "playabilityStatus": {"status": "OK" if playable else "UNPLAYABLE"}}
    return f'<html><link href="{canonical}" rel="canonical"><script>var ytInitialPlayerResponse = {json.dumps(player)};</script></html>'


class FakeYouTube:
    def __init__(self, videos=None, delay=0):
        self.videos = videos if videos is not None else [video(i) for i in range(20)]
        self.calls = Counter()
        self.requests = []
        self.delay = delay
        self.search_ids = None
        self.pages = {}
        self.omit_ids = set()
        self.search_status = 200
        self.metadata_status = 200
        self.short_delays = {}
        self.active = 0
        self.max_active = 0

    async def __call__(self, request):
        self.requests.append(request)
        self.active += 1
        self.max_active = max(self.max_active, self.active)
        try:
            kind = request.url.path.rsplit("/", 1)[-1]
            bucket = kind if kind in {"search", "videos"} else "shorts"
            self.calls[bucket] += 1
            await asyncio.sleep(self.short_delays.get(kind, self.delay))
            if bucket == "search":
                if self.search_status != 200:
                    return httpx.Response(self.search_status, json={"error": {"errors": [{"reason": "quotaExceeded"}]}})
                ids = self.search_ids(request) if self.search_ids else [v["id"] for v in self.videos]
                return httpx.Response(200, json={"items": [{"id": {"videoId": i}} for i in ids]})
            if bucket == "videos":
                if self.metadata_status != 200:
                    return httpx.Response(self.metadata_status, json={"error": {"errors": [{"reason": "quotaExceeded"}]}})
                ids = request.url.params["id"].split(",")
                return httpx.Response(200, json={"items": [v for v in self.videos if v["id"] in ids and v["id"] not in self.omit_ids]})
            override = self.pages.get(kind)
            if isinstance(override, httpx.Response):
                return override
            return httpx.Response(200, text=override if override is not None else page(kind))
        finally:
            self.active -= 1
