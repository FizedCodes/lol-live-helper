"""SQLite storage for synced matches and matchup aggregation."""
from __future__ import annotations

import sqlite3
from pathlib import Path

DB_PATH = Path(__file__).resolve().parent.parent / "data" / "helper.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS matchups (
    match_id TEXT NOT NULL,
    my_champ TEXT NOT NULL,
    enemy_champ TEXT NOT NULL,
    position TEXT NOT NULL,
    is_lane_opponent INTEGER NOT NULL,
    win INTEGER NOT NULL,
    PRIMARY KEY (match_id, enemy_champ)
);
"""


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
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


def known_match_ids(conn: sqlite3.Connection) -> set[str]:
    return {r["match_id"] for r in conn.execute("SELECT DISTINCT match_id FROM matchups")}


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
        rows.append((match_id, my_champ, p["championName"], my_pos, is_laner, win))

    conn.executemany(
        "INSERT OR IGNORE INTO matchups (match_id, my_champ, enemy_champ, position, is_lane_opponent, win) "
        "VALUES (?, ?, ?, ?, ?, ?)",
        rows,
    )
    conn.commit()
    return True


def _agg(row: sqlite3.Row | None) -> dict | None:
    if row is None or row["games"] == 0:
        return None
    games, wins = row["games"], row["wins"]
    return {"games": games, "wins": wins, "win_rate": round(100.0 * wins / games, 1)}


def matchup_stats(conn: sqlite3.Connection, my_champ: str, enemy_champ: str) -> dict:
    """Personal stats for facing enemy_champ: overall, as lane opponent, and on my_champ specifically."""
    q = "SELECT COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM matchups WHERE enemy_champ = ?"
    vs_any = _agg(conn.execute(q, (enemy_champ,)).fetchone())
    vs_lane = _agg(conn.execute(q + " AND is_lane_opponent = 1", (enemy_champ,)).fetchone())
    on_champ = _agg(conn.execute(q + " AND my_champ = ?", (enemy_champ, my_champ)).fetchone())
    return {"vs_any": vs_any, "vs_as_laner": vs_lane, "on_my_champ": on_champ}


def champ_overall(conn: sqlite3.Connection, my_champ: str) -> dict | None:
    row = conn.execute(
        "SELECT COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
        "(SELECT DISTINCT match_id, win FROM matchups WHERE my_champ = ?)",
        (my_champ,),
    ).fetchone()
    return _agg(row)


def summary(conn: sqlite3.Connection) -> dict:
    total = conn.execute("SELECT COUNT(DISTINCT match_id) AS n FROM matchups").fetchone()["n"]
    champs = conn.execute(
        "SELECT my_champ, COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
        "(SELECT DISTINCT match_id, my_champ, win FROM matchups) GROUP BY my_champ ORDER BY games DESC"
    ).fetchall()
    return {
        "matches_synced": total,
        "champions": [
            {"champion": c["my_champ"], "games": c["games"], "win_rate": round(100.0 * c["wins"] / c["games"], 1)}
            for c in champs
        ],
    }
