"""Streaming Sync must not leak SQLite connections on early errors."""
from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from fastapi import HTTPException

from app import routes_sync, store


class SyncConnectionCleanupTests(unittest.IsolatedAsyncioTestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory()
        self.original_db_path = store.DB_PATH
        store.DB_PATH = Path(self.temp_dir.name) / "helper.db"
        self._opened: list = []
        self._real_connect = store.connect

        def tracking_connect():
            conn = self._real_connect()
            self._opened.append(conn)
            return conn

        self._connect_patch = patch.object(store, "connect", tracking_connect)
        self._connect_patch.start()
        # routes_sync imported store as a module attribute — patch there too.
        self._routes_connect_patch = patch.object(
            routes_sync.store, "connect", tracking_connect
        )
        self._routes_connect_patch.start()

    def tearDown(self) -> None:
        self._routes_connect_patch.stop()
        self._connect_patch.stop()
        store.DB_PATH = self.original_db_path
        self.temp_dir.cleanup()

    def _assert_all_closed(self) -> None:
        self.assertTrue(self._opened, "expected sync to open a DB connection")
        for i, conn in enumerate(self._opened):
            with self.subTest(conn=i):
                with self.assertRaises(Exception):
                    # sqlite3 raises ProgrammingError once close() was called.
                    conn.execute("SELECT 1")

    async def test_stream_without_riot_id_closes_connection(self):
        with self.assertRaises(HTTPException) as ctx:
            await routes_sync.sync_matches(stream=True)
        self.assertEqual(ctx.exception.status_code, 400)
        self._assert_all_closed()

    async def test_stream_riot_error_closes_connection(self):
        bootstrap = self._real_connect()
        try:
            store.set_meta(bootstrap, "puuid", "test-puuid")
        finally:
            bootstrap.close()
        self._opened.clear()

        with patch.object(
            routes_sync.riot_service,
            "web_api",
            return_value=type(
                "Api",
                (),
                {
                    "get_match_ids": staticmethod(
                        lambda *a, **k: (_ for _ in ()).throw(
                            RuntimeError("Riot rejected the API key")
                        )
                    )
                },
            )(),
        ):
            with self.assertRaises(HTTPException) as ctx:
                await routes_sync.sync_matches(stream=True)
        self.assertEqual(ctx.exception.status_code, 400)
        self._assert_all_closed()


if __name__ == "__main__":
    unittest.main()
