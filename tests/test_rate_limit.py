"""Tests for the shared Riot API sliding-window rate limiter."""
import asyncio
import time
import unittest

from app.rate_limit import SlidingWindowLimiter, reset_limiter_for_tests


class RateLimitTests(unittest.IsolatedAsyncioTestCase):
    async def test_short_window_paces_bursts(self):
        limiter = SlidingWindowLimiter((3, 0.2))
        started = time.monotonic()
        for _ in range(6):
            await limiter.acquire()
        elapsed = time.monotonic() - started
        # 6 acquires with max 3 / 0.2s needs at least one full window of waiting.
        self.assertGreaterEqual(elapsed, 0.18)

    async def test_long_window_caps_total(self):
        limiter = SlidingWindowLimiter((100, 1.0), (4, 0.5))
        started = time.monotonic()
        for _ in range(5):
            await limiter.acquire()
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 0.45)

    async def test_concurrent_acquires_respect_cap(self):
        limiter = reset_limiter_for_tests(short=(5, 0.25), long=(50, 10.0))
        started = time.monotonic()
        await asyncio.gather(*(limiter.acquire() for _ in range(10)))
        elapsed = time.monotonic() - started
        self.assertGreaterEqual(elapsed, 0.2)
        snap = limiter.snapshot()
        self.assertEqual(len(snap["buckets"]), 2)


if __name__ == "__main__":
    unittest.main()
