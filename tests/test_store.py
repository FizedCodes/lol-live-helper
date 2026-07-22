import sqlite3
import tempfile
import unittest
from pathlib import Path

from app import store


def match_payload(match_id: str, puuid: str, my_champ: str, enemy_champ: str, win: bool) -> dict:
    return {
        "metadata": {"matchId": match_id},
        "info": {
            "gameDuration": 1800,
            "queueId": 420,
            "participants": [
                {
                    "puuid": puuid,
                    "championName": my_champ,
                    "teamId": 100,
                    "teamPosition": "MIDDLE",
                    "win": win,
                },
                {
                    "puuid": "enemy",
                    "championName": enemy_champ,
                    "teamId": 200,
                    "teamPosition": "MIDDLE",
                    "win": not win,
                },
            ],
        },
    }


class StoreAccountScopingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = store.DB_PATH
        store.DB_PATH = Path(self.temp_dir.name) / "helper.db"

    def tearDown(self) -> None:
        store.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def test_match_history_and_aggregates_are_scoped_by_puuid(self) -> None:
        conn = store.connect()
        try:
            store.record_match(conn, match_payload("MATCH-1", "account-a", "Ahri", "Zed", True), "account-a")
            store.record_match(conn, match_payload("MATCH-1", "account-b", "Ahri", "Zed", False), "account-b")

            self.assertEqual(store.known_match_ids(conn, "account-a"), {"MATCH-1"})
            self.assertEqual(store.known_match_ids(conn, "account-b"), {"MATCH-1"})
            self.assertEqual(
                store.matchup_stats(conn, "account-a", "Ahri", "Zed")["vs_any"]["win_rate"],
                100.0,
            )
            self.assertEqual(
                store.matchup_stats(conn, "account-b", "Ahri", "Zed")["vs_any"]["win_rate"],
                0.0,
            )
            self.assertEqual(store.summary(conn, "account-a")["matches_synced"], 1)
            self.assertEqual(store.summary(conn, "unseen-account")["matches_synced"], 0)
        finally:
            conn.close()

    def test_legacy_rows_are_archived_until_account_history_is_resynced(self) -> None:
        conn = sqlite3.connect(store.DB_PATH)
        conn.executescript(
            """
            CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            INSERT INTO meta (key, value) VALUES ('puuid', 'account-a');
            CREATE TABLE matchups (
                match_id TEXT NOT NULL,
                my_champ TEXT NOT NULL,
                enemy_champ TEXT NOT NULL,
                position TEXT NOT NULL,
                is_lane_opponent INTEGER NOT NULL,
                win INTEGER NOT NULL,
                PRIMARY KEY (match_id, enemy_champ)
            );
            INSERT INTO matchups VALUES ('MATCH-1', 'Ahri', 'Zed', 'MIDDLE', 1, 1);
            """
        )
        conn.close()

        migrated = store.connect()
        try:
            columns = {row["name"] for row in migrated.execute("PRAGMA table_info(matchups)")}
            self.assertIn("puuid", columns)
            self.assertEqual(store.known_match_ids(migrated, "account-a"), set())
            self.assertEqual(store.known_match_ids(migrated, "account-b"), set())
            self.assertEqual(
                store.known_match_ids(migrated, store.LEGACY_UNSCOPED_PUUID),
                {"MATCH-1"},
            )

            store.record_match(
                migrated,
                match_payload("MATCH-1", "account-a", "Ahri", "Zed", True),
                "account-a",
            )
            self.assertEqual(store.summary(migrated, "account-a")["matches_synced"], 1)
            self.assertEqual(store.summary(migrated, "account-b")["matches_synced"], 0)
        finally:
            migrated.close()


if __name__ == "__main__":
    unittest.main()
