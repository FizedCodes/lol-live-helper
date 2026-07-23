"""Tests for post-game report builder."""
import unittest

from app import postgame


def _participant(puuid, champ, team, pos, **kwargs):
    base = {
        "puuid": puuid,
        "participantId": kwargs.pop("pid", 1),
        "championName": champ,
        "teamId": team,
        "teamPosition": pos,
        "win": kwargs.pop("win", True),
        "kills": 6,
        "deaths": 4,
        "assists": 8,
        "totalMinionsKilled": 200,
        "neutralMinionsKilled": 10,
        "visionScore": 22,
        "totalDamageDealtToChampions": 20_000,
        "goldEarned": 12_500,
        "turretKills": 1,
        "turretTakedowns": 3,
        "inhibitorKills": 0,
        "dragonKills": 0,
        "baronKills": 0,
        "wardsPlaced": 8,
        "wardsKilled": 2,
        "item0": 6655,
        "item1": 3020,
        "item2": 3089,
        "item3": 0,
        "item4": 0,
        "item5": 0,
        "item6": 3340,
        "riotIdGameName": kwargs.pop("name", "Player"),
        "riotIdTagline": kwargs.pop("tag", "NA1"),
        "challenges": {"killParticipation": 0.55},
    }
    base.update(kwargs)
    return base


def _match():
    return {
        "metadata": {"matchId": "NA1_TEST"},
        "info": {
            "gameDuration": 1800,
            "queueId": 420,
            "gameCreation": 1_700_000_000_000,
            "participants": [
                _participant("me", "Ahri", 100, "MIDDLE", pid=1, win=True, visionScore=4),
                _participant("ally", "LeeSin", 100, "JUNGLE", pid=2, win=True,
                             name="Ally", totalDamageDealtToChampions=15_000),
                _participant("foe", "Zed", 200, "MIDDLE", pid=6, win=False,
                             name="Foe", kills=10, deaths=2, assists=4,
                             totalMinionsKilled=220, visionScore=18,
                             totalDamageDealtToChampions=28_000),
            ],
        },
    }


def _timeline():
    return {
        "info": {
            "frames": [
                {"events": [
                    {"type": "ITEM_PURCHASED", "participantId": 1, "itemId": 1056, "timestamp": 0},
                    {"type": "ITEM_PURCHASED", "participantId": 1, "itemId": 2003, "timestamp": 1000},
                    {"type": "ITEM_PURCHASED", "participantId": 1, "itemId": 6655, "timestamp": 600_000},
                    {"type": "ITEM_PURCHASED", "participantId": 6, "itemId": 1036, "timestamp": 0},
                    {"type": "ITEM_PURCHASED", "participantId": 6, "itemId": 6691, "timestamp": 500_000},
                ]},
            ],
        },
    }


class PostgameTests(unittest.TestCase):
    def test_report_grades_and_laner(self):
        report = postgame.build_report(_match(), "me", timeline=_timeline())
        self.assertTrue(report["ready"])
        self.assertEqual(report["result"], "Win")
        self.assertEqual(report["me"]["champion"], "Ahri")
        self.assertEqual(report["opponent"]["champion"], "Zed")
        self.assertTrue(report["opponent"]["is_lane_opponent"])
        # Low vision mid should be a focus item.
        self.assertTrue(any(f["key"] == "vision_per_min" for f in report["focus"]))
        self.assertTrue(report["timeline_ready"])
        self.assertTrue(any(b["id"] == 6655 for b in report["me"]["build_order"]))
        # Potion skipped.
        self.assertFalse(any(b["id"] == 2003 for b in report["me"]["build_order"]))
        self.assertTrue(any(r["key"] == "cs_per_min" for r in report["compare"]))

    def test_vs_champ_avg(self):
        avgs = {
            "games": 5,
            "cs_per_min": 8.0,
            "vision_per_min": 1.0,
            "kill_participation": 60.0,
            "damage_share": 30.0,
            "kda": 4.0,
        }
        report = postgame.build_report(_match(), "me", champ_avgs=avgs)
        self.assertTrue(report["vs_champ_avg"])
        self.assertEqual(report["champ_avg_games"], 5)


if __name__ == "__main__":
    unittest.main()
