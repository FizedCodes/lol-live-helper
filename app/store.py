"""SQLite storage for synced matches and matchup aggregation."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "helper.db"
LEGACY_UNSCOPED_PUUID = "__legacy_unscoped__"

MATCHUPS_SCHEMA = """
CREATE TABLE matchups (
    puuid TEXT NOT NULL,
    match_id TEXT NOT NULL,
    my_champ TEXT NOT NULL,
    enemy_champ TEXT NOT NULL,
    position TEXT NOT NULL,
    is_lane_opponent INTEGER NOT NULL,
    win INTEGER NOT NULL,
    PRIMARY KEY (puuid, match_id, enemy_champ)
);
"""

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matchups (
    puuid TEXT NOT NULL,
    match_id TEXT NOT NULL,
    my_champ TEXT NOT NULL,
    enemy_champ TEXT NOT NULL,
    position TEXT NOT NULL,
    is_lane_opponent INTEGER NOT NULL,
    win INTEGER NOT NULL,
    PRIMARY KEY (puuid, match_id, enemy_champ)
);
"""


def _migrate_matchups(conn: sqlite3.Connection) -> None:
    """Add account ownership to databases created before matchups were PUUID-scoped."""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(matchups)")}
    if "puuid" in columns:
        return

    conn.execute("BEGIN IMMEDIATE")
    try:
        # Another connection may have completed the migration while this one waited.
        columns = {row["name"] for row in conn.execute("PRAGMA table_info(matchups)")}
        if "puuid" in columns:
            conn.commit()
            return

        conn.execute("ALTER TABLE matchups RENAME TO matchups_legacy")
        conn.execute(MATCHUPS_SCHEMA)
        conn.execute(
            "INSERT INTO matchups "
            "(puuid, match_id, my_champ, enemy_champ, position, is_lane_opponent, win) "
            "SELECT ?, match_id, my_champ, enemy_champ, position, is_lane_opponent, win "
            "FROM matchups_legacy",
            # The old schema cannot prove which account owned a row after an
            # account switch. Preserve the data, but exclude it from personal
            # stats and let the next sync fetch authoritative account history.
            (LEGACY_UNSCOPED_PUUID,),
        )
        conn.execute("DROP TABLE matchups_legacy")
        conn.commit()
    except Exception:
        conn.rollback()
        raise


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    _migrate_matchups(conn)
    return conn


def get_meta(conn: sqlite3.Connection, key: str) -> str | None:
    row = conn.execute("SELECT value FROM meta WHERE key = ?", (key,)).fetchone()
    return row["value"] if row else None


def set_meta(conn: sqlite3.Connection, key: str, value: str) -> None:
    conn.execute(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        (key, value),
    )
    conn.commit()


def known_match_ids(conn: sqlite3.Connection, puuid: str) -> set[str]:
    return {
        r["match_id"]
        for r in conn.execute("SELECT DISTINCT match_id FROM matchups WHERE puuid = ?", (puuid,))
    }


# Summoner's Rift 5v5 queues: normal draft, ranked solo, normal blind, ranked flex, quickplay
SR_QUEUES = {400, 420, 430, 440, 490}


def record_match(conn: sqlite3.Connection, match: dict, puuid: str) -> bool:
    """Extract this player's matchups from one Match-V5 payload. Returns True if stored."""
    info = match.get("info", {})
    participants = info.get("participants", [])
    me = next((p for p in participants if p.get("puuid") == puuid), None)
    if me is None or info.get("gameDuration", 0) < 300:  # skip remakes
        return False
    if info.get("queueId") not in SR_QUEUES:  # skip ARAM, arena, bots, etc.
        return False

    match_id = match["metadata"]["matchId"]
    my_champ = me["championName"]
    my_pos = me.get("teamPosition") or "UNKNOWN"
    win = 1 if me.get("win") else 0

    rows = []
    for p in participants:
        if p.get("teamId") == me.get("teamId"):
            continue
        is_laner = 1 if (p.get("teamPosition") or "") == my_pos and my_pos != "UNKNOWN" else 0
        rows.append((puuid, match_id, my_champ, p["championName"], my_pos, is_laner, win))

    conn.executemany(
        "INSERT OR IGNORE INTO matchups "
        "(puuid, match_id, my_champ, enemy_champ, position, is_lane_opponent, win) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return True


def _agg(row: sqlite3.Row | None) -> dict | None:
    if row is None or row["games"] == 0:
        return None
    games, wins = row["games"], row["wins"]
    return {"games": games, "wins": wins, "win_rate": round(100.0 * wins / games, 1)}


def matchup_stats(conn: sqlite3.Connection, puuid: str, my_champ: str, enemy_champ: str) -> dict:
    """Personal stats for facing enemy_champ: overall, as lane opponent, and on my_champ specifically."""
    q = (
        "SELECT COUNT(DISTINCT match_id) AS games, SUM(win) AS wins "
        "FROM matchups WHERE puuid = ? AND enemy_champ = ?"
    )
    params = (puuid, enemy_champ)
    vs_any = _agg(conn.execute(q, params).fetchone())
    vs_lane = _agg(conn.execute(q + " AND is_lane_opponent = 1", params).fetchone())
    on_champ = _agg(conn.execute(q + " AND my_champ = ?", (*params, my_champ)).fetchone())
    return {"vs_any": vs_any, "vs_as_laner": vs_lane, "on_my_champ": on_champ}


def champ_overall(conn: sqlite3.Connection, puuid: str, my_champ: str) -> dict | None:
    row = conn.execute(
        "SELECT COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
        "(SELECT DISTINCT match_id, win FROM matchups WHERE puuid = ? AND my_champ = ?)",
        (puuid, my_champ),
    ).fetchone()
    return _agg(row)


def summary(conn: sqlite3.Connection, puuid: str) -> dict:
    total = conn.execute(
        "SELECT COUNT(DISTINCT match_id) AS n FROM matchups WHERE puuid = ?", (puuid,)
    ).fetchone()["n"]
    champs = conn.execute(
        "SELECT my_champ, COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
        "(SELECT DISTINCT match_id, my_champ, win FROM matchups WHERE puuid = ?) "
        "GROUP BY my_champ ORDER BY games DESC",
        (puuid,),
    ).fetchall()
    return {
        "matches_synced": total,
        "champions": [
            {"champion": c["my_champ"], "games": c["games"], "win_rate": round(100.0 * c["wins"] / c["games"], 1)}
            for c in champs
        ],
    }
