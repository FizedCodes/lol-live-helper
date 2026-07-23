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
CREATE TABLE IF NOT EXISTS matches (
    puuid TEXT NOT NULL,
    match_id TEXT NOT NULL,
    my_champ TEXT NOT NULL,
    position TEXT NOT NULL,
    queue_id INTEGER NOT NULL,
    win INTEGER NOT NULL,
    played_at INTEGER NOT NULL,
    PRIMARY KEY (puuid, match_id)
);
"""

# Ranked solo/duo + ranked flex. Everything else in SR_QUEUES is "regular".
RANKED_QUEUES = {420, 440}
NORMAL_QUEUES = {400, 430, 490}


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


def _backfill_matches_from_matchups(conn: sqlite3.Connection) -> None:
    """Older DBs only had matchups. Seed matches without queue/time until a re-sync."""
    has_any = conn.execute("SELECT 1 FROM matches LIMIT 1").fetchone()
    if has_any:
        return
    conn.execute(
        "INSERT OR IGNORE INTO matches "
        "(puuid, match_id, my_champ, position, queue_id, win, played_at) "
        "SELECT puuid, match_id, my_champ, MAX(position), 0, MAX(win), 0 "
        "FROM matchups WHERE puuid != ? "
        "GROUP BY puuid, match_id, my_champ",
        (LEGACY_UNSCOPED_PUUID,),
    )
    conn.commit()


def connect() -> sqlite3.Connection:
    DB_PATH.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.executescript(SCHEMA)
    _migrate_matchups(conn)
    _backfill_matches_from_matchups(conn)
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
    """Match IDs we do not need to re-fetch.

    Backfilled rows (queue_id = 0) are intentionally *not* treated as known so the
    next sync can upgrade them with real queue + timestamp for ranked/normal splits.
    """
    return {
        r["match_id"]
        for r in conn.execute(
            "SELECT match_id FROM matches WHERE puuid = ? AND queue_id != 0",
            (puuid,),
        )
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
    queue_id = info.get("queueId")
    if queue_id not in SR_QUEUES:  # skip ARAM, arena, bots, etc.
        return False

    match_id = match["metadata"]["matchId"]
    my_champ = me["championName"]
    my_pos = me.get("teamPosition") or "UNKNOWN"
    win = 1 if me.get("win") else 0
    # Match-V5 gameCreation is milliseconds since epoch.
    played_at = int((info.get("gameCreation") or 0) // 1000)

    conn.execute(
        "INSERT INTO matches "
        "(puuid, match_id, my_champ, position, queue_id, win, played_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?) "
        "ON CONFLICT(puuid, match_id) DO UPDATE SET "
        "my_champ = excluded.my_champ, "
        "position = excluded.position, "
        "queue_id = excluded.queue_id, "
        "win = excluded.win, "
        "played_at = excluded.played_at",
        (puuid, match_id, my_champ, my_pos, queue_id, win, played_at),
    )

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
    games, wins = int(row["games"]), int(row["wins"] or 0)
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
        "SELECT COUNT(*) AS games, SUM(win) AS wins FROM matches "
        "WHERE puuid = ? AND my_champ = ?",
        (puuid, my_champ),
    ).fetchone()
    if row and row["games"]:
        return _agg(row)
    # Fallback for edge cases where only matchups exist.
    row = conn.execute(
        "SELECT COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
        "(SELECT DISTINCT match_id, win FROM matchups WHERE puuid = ? AND my_champ = ?)",
        (puuid, my_champ),
    ).fetchone()
    return _agg(row)


def queue_win_rate(conn: sqlite3.Connection, puuid: str, queues: set[int] | None = None) -> dict | None:
    """Win rate across matches, optionally filtered to a set of queue IDs."""
    if queues is None:
        row = conn.execute(
            "SELECT COUNT(*) AS games, SUM(win) AS wins FROM matches WHERE puuid = ?",
            (puuid,),
        ).fetchone()
    else:
        placeholders = ",".join("?" * len(queues))
        row = conn.execute(
            f"SELECT COUNT(*) AS games, SUM(win) AS wins FROM matches "
            f"WHERE puuid = ? AND queue_id IN ({placeholders})",
            (puuid, *queues),
        ).fetchone()
    return _agg(row)


def summary(conn: sqlite3.Connection, puuid: str) -> dict:
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM matches WHERE puuid = ?", (puuid,)
    ).fetchone()["n"]
    if not total:
        total = conn.execute(
            "SELECT COUNT(DISTINCT match_id) AS n FROM matchups WHERE puuid = ?", (puuid,)
        ).fetchone()["n"]

    champs = conn.execute(
        "SELECT my_champ, COUNT(*) AS games, SUM(win) AS wins FROM matches "
        "WHERE puuid = ? GROUP BY my_champ ORDER BY games DESC",
        (puuid,),
    ).fetchall()
    if not champs:
        champs = conn.execute(
            "SELECT my_champ, COUNT(DISTINCT match_id) AS games, SUM(win) AS wins FROM "
            "(SELECT DISTINCT match_id, my_champ, win FROM matchups WHERE puuid = ?) "
            "GROUP BY my_champ ORDER BY games DESC",
            (puuid,),
        ).fetchall()

    recent = conn.execute(
        "SELECT my_champ, COUNT(*) AS games, SUM(win) AS wins, MAX(played_at) AS last_played "
        "FROM matches WHERE puuid = ? "
        "GROUP BY my_champ ORDER BY last_played DESC, games DESC LIMIT 12",
        (puuid,),
    ).fetchall()

    ranked_known = conn.execute(
        "SELECT COUNT(*) AS n FROM matches WHERE puuid = ? AND queue_id IN (420, 440)",
        (puuid,),
    ).fetchone()["n"]

    return {
        "matches_synced": total,
        "overall": queue_win_rate(conn, puuid),
        "ranked": queue_win_rate(conn, puuid, RANKED_QUEUES),
        "normals": queue_win_rate(conn, puuid, NORMAL_QUEUES),
        "ranked_ready": ranked_known > 0,
        "champions": [
            {
                "champion": c["my_champ"],
                "games": c["games"],
                "wins": c["wins"],
                "win_rate": round(100.0 * c["wins"] / c["games"], 1),
            }
            for c in champs
        ],
        "recent_champions": [
            {
                "champion": c["my_champ"],
                "games": c["games"],
                "wins": c["wins"],
                "win_rate": round(100.0 * c["wins"] / c["games"], 1),
                "last_played": c["last_played"],
            }
            for c in recent
        ],
    }
