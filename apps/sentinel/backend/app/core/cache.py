"""
F033: Lightweight in-process response cache with TTL.

Uses a thread-safe dict for simple per-key TTL caching of expensive read-only
queries (projects list, datasets list, registry list). Redis-backed caching
can be layered on top later via fastapi-cache2 without changing call sites.

Usage:
    from app.core.cache import ttl_cache, cache_bust

    @router.get("/")
    def list_projects(db=...):
        cached = ttl_cache.get("projects:all")
        if cached is not None:
            return cached
        result = ... # expensive DB query
        ttl_cache.set("projects:all", result, ttl=30)
        return result

    # On write operations:
    cache_bust("projects:all")
"""
import logging
import threading
import time
from typing import Any

logger = logging.getLogger("datasentinel.cache")


class TTLCache:
    """Thread-safe in-memory cache with per-key TTL (seconds)."""

    def __init__(self):
        self._store: dict[str, tuple[Any, float]] = {}  # key → (value, expires_at)
        self._lock = threading.Lock()

    def get(self, key: str) -> Any | None:
        with self._lock:
            entry = self._store.get(key)
            if entry is None:
                return None
            value, expires_at = entry
            if time.monotonic() > expires_at:
                del self._store[key]
                return None
            return value

    def set(self, key: str, value: Any, ttl: int = 30) -> None:
        with self._lock:
            self._store[key] = (value, time.monotonic() + ttl)

    def bust(self, *keys: str) -> None:
        """Invalidate one or more cache keys immediately."""
        with self._lock:
            for key in keys:
                self._store.pop(key, None)

    def bust_prefix(self, prefix: str) -> None:
        """Invalidate all keys that start with prefix."""
        with self._lock:
            stale = [k for k in self._store if k.startswith(prefix)]
            for k in stale:
                del self._store[k]

    def clear(self) -> None:
        with self._lock:
            self._store.clear()

    def gc(self) -> int:
        """Remove all expired entries. Returns count removed."""
        now = time.monotonic()
        with self._lock:
            expired = [k for k, (_, exp) in self._store.items() if now > exp]
            for k in expired:
                del self._store[k]
        return len(expired)


# Singleton — import this directly
ttl_cache = TTLCache()


def cache_bust(*keys: str) -> None:
    """Shorthand for invalidating cache keys on write operations."""
    ttl_cache.bust(*keys)
