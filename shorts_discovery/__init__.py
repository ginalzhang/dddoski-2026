"""Public async function and reusable service; no network activity on import."""

from .config import Settings
from .pipeline import DiscoveryService, discover_shorts

__all__ = ["Settings", "DiscoveryService", "discover_shorts"]
