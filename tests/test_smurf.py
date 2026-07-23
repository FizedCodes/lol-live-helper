"""Tests for player smurf / account-check heuristics."""
import unittest

from app.routes_player import _smurf_signal


def _match(**kwargs):
    base = {
        "champion": "Ahri",
        "win": True,
        "kills": 5,
        "deaths": 2,
        "assists": 7,
        "cs": 180,
        "queue_id": 420,
        "duration": 1800,
        "played_at": 1_700_000_000,
    }
    base.update(kwargs)
    return base


class SmurfSignalTests(unittest.TestCase):
    def test_normal_account_stays_ok(self):
        recent = [
            _match(win=i % 2 == 0, champion=["Ahri", "Syndra", "Lux", "Orianna"][i % 4],
                   kills=4, deaths=4, assists=5, played_at=1_700_000_000 + i * 86400)
            for i in range(10)
        ]
        solo = {"tier": "GOLD", "division": "II", "games": 120, "win_rate": 51.0,
                "wins": 61, "losses": 59, "lp": 40, "queue": "Solo"}
        out = _smurf_signal(210, 180, recent, solo, None)
        self.assertEqual(out["severity"], "ok")
        self.assertFalse(out["likely_smurf"])

    def test_emerald_thin_sample_flags(self):
        out = _smurf_signal(
            72, 28, [],
            {"tier": "EMERALD", "division": "IV", "games": 28, "win_rate": 64.0,
             "wins": 18, "losses": 10, "lp": 12, "queue": "Solo"},
            None,
        )
        self.assertGreaterEqual(out["score"], 4)
        self.assertEqual(out["severity"], "flagged")
        self.assertTrue(any("Emerald" in f for f in out["flags"]))

    def test_otp_and_hot_wr_worth_glance(self):
        recent = [
            _match(champion="Zed", win=True, kills=12, deaths=2, assists=4,
                   played_at=1_700_000_000 + i * 3600)
            for i in range(10)
        ]
        out = _smurf_signal(150, 90, recent, None, None)
        self.assertGreaterEqual(out["score"], 2)
        self.assertIn(out["severity"], ("watch", "flagged"))
        self.assertTrue(any("OTP" in f or "win rate" in f for f in out["flags"]))

    def test_low_ranked_alone_is_soft(self):
        # A single soft volume flag should not hard-flag by itself.
        out = _smurf_signal(180, 40, [], None, None)
        self.assertLess(out["score"], 4)
        self.assertNotEqual(out["severity"], "flagged")


if __name__ == "__main__":
    unittest.main()
