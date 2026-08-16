"""LP delta from League-V4 snapshots (Match-V5 has no LP field)."""
import tempfile
import unittest
from pathlib import Path

from app import lp, store


def _snap(*, wins, losses, lp, captured_at, tier="GOLD", division="II", mini=None):
    return {
        "tier": tier,
        "division": division,
        "lp": lp,
        "wins": wins,
        "losses": losses,
        "mini_series": mini,
        "captured_at": captured_at,
    }


def _game(*, match_id, win, played_at, duration=1800, queue_id=420, remake=False):
    return {
        "match_id": match_id,
        "champion": "Ahri",
        "win": win,
        "queue_id": queue_id,
        "played_at": played_at,
        "duration": duration,
        "remake": remake,
        "kills": 5,
        "deaths": 2,
        "assists": 7,
        "cs": 180,
    }


class LpMathTests(unittest.TestCase):
    def test_same_division_win_and_loss(self):
        before = _snap(wins=10, losses=8, lp=40, captured_at=100)
        after_win = _snap(wins=11, losses=8, lp=62, captured_at=200)
        after_loss = _snap(wins=10, losses=9, lp=22, captured_at=200)
        self.assertEqual(lp.delta_between(before, after_win)["lp_delta"], 22)
        self.assertEqual(lp.delta_between(before, after_loss)["lp_delta"], -18)

    def test_promotion_uses_100_lp_divisions(self):
        before = _snap(wins=20, losses=10, lp=95, captured_at=100, division="IV")
        after = _snap(wins=21, losses=10, lp=12, captured_at=200, division="III")
        out = lp.delta_between(before, after)
        self.assertEqual(out["lp_delta"], 17)
        self.assertEqual(out["lp_event"], "promoted")

    def test_promo_series_stays_at_100(self):
        before = _snap(wins=30, losses=12, lp=100, captured_at=100, division="I",
                       mini={"progress": "W"})
        after = _snap(wins=31, losses=12, lp=100, captured_at=200, division="I",
                      mini={"progress": "WW"})
        out = lp.delta_between(before, after)
        self.assertEqual(out["lp_delta"], 0)
        self.assertEqual(out["lp_event"], "promo")

    def test_master_same_tier_uses_raw_lp(self):
        before = _snap(wins=40, losses=20, lp=180, captured_at=100, tier="MASTER", division="")
        after = _snap(wins=41, losses=20, lp=198, captured_at=200, tier="MASTER", division="")
        self.assertEqual(lp.delta_between(before, after)["lp_delta"], 18)


class AttachLpTests(unittest.TestCase):
    def test_one_ranked_game_between_snapshots(self):
        t0, start, end, t1 = 1_700_000_000, 1_700_000_100, 1_700_001_900, 1_700_002_000
        matches = [_game(match_id="M1", win=True, played_at=start, duration=end - start)]
        snaps = {
            "RANKED_SOLO_5x5": [
                _snap(wins=10, losses=8, lp=40, captured_at=t0),
                _snap(wins=11, losses=8, lp=58, captured_at=t1),
            ]
        }
        lp.attach_lp_deltas(matches, snaps)
        self.assertEqual(matches[0]["lp_delta"], 18)

    def test_snapshot_taken_during_the_game(self):
        start = 1_700_000_000
        t0 = start + 600  # still in game — LP hasn't updated yet
        end = start + 1800
        t1 = end + 30
        matches = [_game(match_id="M1", win=False, played_at=start)]
        snaps = {
            "RANKED_SOLO_5x5": [
                _snap(wins=10, losses=8, lp=40, captured_at=t0),
                _snap(wins=10, losses=9, lp=22, captured_at=t1),
            ]
        }
        lp.attach_lp_deltas(matches, snaps)
        self.assertEqual(matches[0]["lp_delta"], -18)

    def test_lookup_hours_later_still_attaches(self):
        t0, start = 1_700_000_000, 1_700_000_100
        duration = 1800
        t1 = start + duration + 3 * 3600  # searched 3h after the game
        matches = [_game(match_id="M1", win=True, played_at=start, duration=duration)]
        snaps = {
            "RANKED_SOLO_5x5": [
                _snap(wins=10, losses=8, lp=40, captured_at=t0),
                _snap(wins=11, losses=8, lp=61, captured_at=t1),
            ]
        }
        lp.attach_lp_deltas(matches, snaps)
        self.assertEqual(matches[0]["lp_delta"], 21)
        t0, t1 = 1_700_000_000, 1_700_010_000
        matches = [
            _game(match_id="M1", win=True, played_at=t0 + 100),
            _game(match_id="M2", win=True, played_at=t0 + 4000),
        ]
        snaps = {
            "RANKED_SOLO_5x5": [
                _snap(wins=10, losses=8, lp=40, captured_at=t0),
                _snap(wins=12, losses=8, lp=80, captured_at=t1),
            ]
        }
        lp.attach_lp_deltas(matches, snaps)
        self.assertNotIn("lp_delta", matches[0])
        self.assertNotIn("lp_delta", matches[1])

    def test_ranked_remake_is_zero(self):
        matches = [_game(match_id="R1", win=True, played_at=1_700_000_000,
                         duration=180, remake=True)]
        lp.attach_lp_deltas(matches, {})
        self.assertEqual(matches[0]["lp_delta"], 0)
        self.assertEqual(matches[0]["lp_event"], "remake")

    def test_flex_does_not_use_solo_snapshots(self):
        t0, t1 = 1_700_000_000, 1_700_002_000
        matches = [_game(match_id="F1", win=True, played_at=t0 + 50, queue_id=440)]
        snaps = {
            "RANKED_SOLO_5x5": [
                _snap(wins=10, losses=8, lp=40, captured_at=t0),
                _snap(wins=11, losses=8, lp=60, captured_at=t1),
            ]
        }
        lp.attach_lp_deltas(matches, snaps)
        self.assertNotIn("lp_delta", matches[0])


class RankSnapshotStoreTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = store.DB_PATH
        store.DB_PATH = Path(self.temp_dir.name) / "helper.db"

    def tearDown(self) -> None:
        store.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_duplicate_state_keeps_first_timestamp(self):
        conn = store.connect()
        try:
            entry = {
                "queueType": "RANKED_SOLO_5x5",
                "tier": "GOLD",
                "rank": "II",
                "leaguePoints": 40,
                "wins": 10,
                "losses": 8,
            }
            self.assertEqual(store.save_league_entries(conn, "p1", [entry], captured_at=100), 1)
            self.assertEqual(store.save_league_entries(conn, "p1", [entry], captured_at=200), 0)
            snaps = store.list_rank_snapshots(conn, "p1", "RANKED_SOLO_5x5")
            self.assertEqual(len(snaps), 1)
            self.assertEqual(snaps[0]["captured_at"], 100)
        finally:
            conn.close()

    def test_lp_changes_insert_a_new_row(self):
        conn = store.connect()
        try:
            a = {
                "queueType": "RANKED_SOLO_5x5",
                "tier": "GOLD", "rank": "II",
                "leaguePoints": 40, "wins": 10, "losses": 8,
            }
            b = {**a, "leaguePoints": 58, "wins": 11}
            store.save_league_entries(conn, "p1", [a], captured_at=100)
            store.save_league_entries(conn, "p1", [b], captured_at=200)
            snaps = store.list_rank_snapshots(conn, "p1", "RANKED_SOLO_5x5")
            self.assertEqual(len(snaps), 2)
            self.assertEqual(snaps[1]["lp"], 58)
            self.assertEqual(snaps[1]["wins"], 11)
        finally:
            conn.close()


if __name__ == "__main__":
    unittest.main()
