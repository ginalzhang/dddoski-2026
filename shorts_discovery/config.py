import os
from dataclasses import dataclass, field


@dataclass(frozen=True)
class Settings:
    api_key: str = field(repr=False)
    deadline_seconds: float = 28.0
    request_timeout_seconds: float = 5.0
    max_search_calls: int = 8
    daily_search_calls: int = 90
    daily_metadata_calls: int = 9000
    quota_db: str = ".cache/quota.sqlite3"
    max_concurrent_requests: int = 4
    http_concurrency: int = 24
    search_results: int = 25
    verification_limit: int = 100
    search_cache_seconds: float = 300.0
    large_request_search_calls: int = 20
    large_request_verification_limit: int = 400

    def __post_init__(self):
        if not self.api_key.strip():
            raise ValueError("Set YOUTUBE_API_KEY to a YouTube Data API v3 key")
        if not 0 < self.deadline_seconds <= 29:
            raise ValueError("deadline_seconds must be in (0, 29]")
        if not 0 < self.request_timeout_seconds <= self.deadline_seconds:
            raise ValueError("request_timeout_seconds must be positive and within the deadline")
        if not 4 <= self.max_search_calls <= 20:
            raise ValueError("max_search_calls must be between 4 and 20")
        if not 4 <= self.large_request_search_calls <= 20 or self.large_request_verification_limit < 100:
            raise ValueError("large request limits require 4–20 searches and at least 100 verifications")
        if not 1 <= self.search_results <= 50:
            raise ValueError("search_results must be between 1 and 50")
        if min(self.daily_search_calls, self.daily_metadata_calls, self.http_concurrency,
               self.max_concurrent_requests, self.verification_limit) < 1:
            raise ValueError("limits must be positive")

    @classmethod
    def from_env(cls):
        return cls(
            api_key=os.environ.get("YOUTUBE_API_KEY", ""),
            deadline_seconds=float(os.environ.get("DISCOVERY_DEADLINE_SECONDS", "28")),
            request_timeout_seconds=float(os.environ.get("YOUTUBE_REQUEST_TIMEOUT_SECONDS", "5")),
            max_search_calls=int(os.environ.get("YOUTUBE_SEARCH_CALLS_PER_REQUEST", "8")),
            daily_search_calls=int(os.environ.get("YOUTUBE_DAILY_SEARCH_CALLS", "90")),
            daily_metadata_calls=int(os.environ.get("YOUTUBE_DAILY_METADATA_CALLS", "9000")),
            quota_db=os.environ.get("YOUTUBE_QUOTA_DB", ".cache/quota.sqlite3"),
            max_concurrent_requests=int(os.environ.get("DISCOVERY_MAX_CONCURRENT_REQUESTS", "4")),
            large_request_search_calls=int(os.environ.get("YOUTUBE_LARGE_REQUEST_SEARCH_CALLS", "20")),
            large_request_verification_limit=int(os.environ.get("YOUTUBE_LARGE_REQUEST_VERIFICATION_LIMIT", "400")),
            http_concurrency=int(os.environ.get("YOUTUBE_HTTP_CONCURRENCY", "24")),
        )
