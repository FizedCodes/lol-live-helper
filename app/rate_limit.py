"""Shared Riot API rate limiter (process-wide).

Personal / prod keys are typically capped at ~20 requests / 1s and
~100 requests / 2 minutes. We stay a bit under both so live polls, sync,
and player lookups share one budget instead of racing into 429s.
"""
from __future__ import annotations

import asyncio
import time


class SlidingWindowLimiter:
    """Async limiter enforcing one or more (max_requests, window_seconds) caps."""

    def __init__(self, *limits: tuple[int, float]):
        if not limits:
            raise ValueError("At least one (max, window) limit is required")
        self._limits = limits
        self._times: list[float] = []
        self._lock = asyncio.Lock()

    def _prune(self, now: float) -> None:
        longest = max(window for _, window in self._limits)
        cutoff = now - longest
        self._times = [t for t in self._times if t > cutoff]

    def _wait_needed(self, now: float) -> float:
        wait = 0.0
        for max_n, window in self._limits:
            recent = [t for t in self._times if now - t < window]
            if len(recent) < max_n:
                continue
            oldest = min(recent)
            wait = max(wait, window - (now - oldest) + 0.02)
        return wait

    async def acquire(self) -> None:
        """Block until a request slot is available, then consume it."""
        while True:
            async with self._lock:
                now = time.monotonic()
                self._prune(now)
                wait = self._wait_needed(now)
                if wait <= 0:
                    self._times.append(now)
                    return
            await asyncio.sleep(wait)

    def snapshot(self) -> dict:
        """Cheap debug view of how much budget is in use right now."""
        now = time.monotonic()
        self._prune(now)
        buckets = []
        for max_n, window in self._limits:
            used = sum(1 for t in self._times if now - t < window)
            buckets.append({"max": max_n, "window_s": window, "used": used})
        return {"buckets": buckets}


# Module singleton — every RiotWebApi call shares this.
_limiter: SlidingWindowLimiter | None = None


def get_limiter() -> SlidingWindowLimiter:
    global _limiter
    if _limiter is None:
        from app import config

        _limiter = SlidingWindowLimiter(
            (config.riot_rate_limit_short(), config.riot_rate_limit_short_window()),
            (config.riot_rate_limit_long(), config.riot_rate_limit_long_window()),
        )
    return _limiter


def reset_limiter_for_tests(
    short: tuple[int, float] = (20, 1.0),
    long: tuple[int, float] = (100, 120.0),
) -> SlidingWindowLimiter:
    """Replace the singleton (tests only)."""
    global _limiter
    _limiter = SlidingWindowLimiter(short, long)
    return _limiter
