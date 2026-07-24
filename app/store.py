"""SQLite storage for synced matches and matchup aggregation."""
from __future__ import annotations

import json
import sqlite3
import time
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
    duration_s INTEGER NOT NULL DEFAULT 0,
    kills INTEGER NOT NULL DEFAULT 0,
    deaths INTEGER NOT NULL DEFAULT 0,
    assists INTEGER NOT NULL DEFAULT 0,
    cs INTEGER NOT NULL DEFAULT 0,
    vision_score INTEGER NOT NULL DEFAULT 0,
    damage_champions INTEGER NOT NULL DEFAULT 0,
    team_kills INTEGER NOT NULL DEFAULT 0,
    team_damage INTEGER NOT NULL DEFAULT 0,
    gold_earned INTEGER NOT NULL DEFAULT 0,
    perf_ready INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (puuid, match_id)
);
-- Finished Match-V5 payloads (immutable). Shared across Sync + Player lookup.
CREATE TABLE IF NOT EXISTS match_cache (
    match_id TEXT PRIMARY KEY,
    payload TEXT NOT NULL,
    cached_at INTEGER NOT NULL
);
"""

# Columns added after the original matches table shipped.
_MATCH_PERF_COLUMNS = {
    "duration_s": "INTEGER NOT NULL DEFAULT 0",
    "kills": "INTEGER NOT NULL DEFAULT 0",
    "deaths": "INTEGER NOT NULL DEFAULT 0",
    "assists": "INTEGER NOT NULL DEFAULT 0",
    "cs": "INTEGER NOT NULL DEFAULT 0",
    "vision_score": "INTEGER NOT NULL DEFAULT 0",
    "damage_champions": "INTEGER NOT NULL DEFAULT 0",
    "team_kills": "INTEGER NOT NULL DEFAULT 0",
    "team_damage": "INTEGER NOT NULL DEFAULT 0",
    "gold_earned": "INTEGER NOT NULL DEFAULT 0",
    "perf_ready": "INTEGER NOT NULL DEFAULT 0",
}

# Ranked solo/duo + ranked flex. Everything else in SR_QUEUES is "regular".
RANKED_QUEUES = {420, 440}
NORMAL_QUEUES = {400, 430, 490}

# Soft role baselines for op.gg-style grading (personal Riot data, not scraped).
_ROLE_BASELINES = {
    "TOP": {"cs_per_min": 6.2, "vision_per_min": 0.55, "kp": 0.48, "dmg_share": 0.22, "kda": 2.4},
    "JUNGLE": {"cs_per_min": 5.2, "vision_per_min": 0.95, "kp": 0.58, "dmg_share": 0.20, "kda": 2.8},
    "MIDDLE": {"cs_per_min": 6.5, "vision_per_min": 0.55, "kp": 0.50, "dmg_share": 0.26, "kda": 2.6},
    "BOTTOM": {"cs_per_min": 7.0, "vision_per_min": 0.50, "kp": 0.50, "dmg_share": 0.28, "kda": 2.6},
    "UTILITY": {"cs_per_min": 1.3, "vision_per_min": 1.5, "kp": 0.58, "dmg_share": 0.10, "kda": 2.8},
    "UNKNOWN": {"cs_per_min": 5.5, "vision_per_min": 0.7, "kp": 0.50, "dmg_share": 0.20, "kda": 2.5},
}


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


def _migrate_match_perf(conn: sqlite3.Connection) -> None:
    """Add per-game performance columns used by the personal tracker."""
    columns = {row["name"] for row in conn.execute("PRAGMA table_info(matches)")}
    for name, decl in _MATCH_PERF_COLUMNS.items():
        if name not in columns:
            conn.execute(f"ALTER TABLE matches ADD COLUMN {name} {decl}")
    conn.commit()


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
    _migrate_match_perf(conn)
    # match_cache / timeline / saved post-game reports — older DBs pick these up here.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS match_cache ("
        "match_id TEXT PRIMARY KEY, payload TEXT NOT NULL, cached_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS timeline_cache ("
        "match_id TEXT PRIMARY KEY, payload TEXT NOT NULL, cached_at INTEGER NOT NULL)"
    )
    conn.execute(
        "CREATE TABLE IF NOT EXISTS postgame_reports ("
        "puuid TEXT NOT NULL, match_id TEXT NOT NULL, payload TEXT NOT NULL, "
        "cached_at INTEGER NOT NULL, PRIMARY KEY (puuid, match_id))"
    )
    conn.commit()
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


def get_match_payload(conn: sqlite3.Connection, match_id: str) -> dict | None:
    """Return a cached Match-V5 JSON blob, or None."""
    row = conn.execute(
        "SELECT payload FROM match_cache WHERE match_id = ?", (match_id,)
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def put_match_payload(conn: sqlite3.Connection, match_id: str, payload: dict) -> None:
    """Store a finished match. Safe to call repeatedly — payload is immutable."""
    conn.execute(
        "INSERT INTO match_cache (match_id, payload, cached_at) VALUES (?, ?, ?) "
        "ON CONFLICT(match_id) DO NOTHING",
        (match_id, json.dumps(payload), int(time.time())),
    )
    conn.commit()


def known_match_ids(conn: sqlite3.Connection, puuid: str) -> set[str]:
    """Match IDs we do not need to re-fetch.

    Backfilled rows (queue_id = 0) and rows missing performance stats are
    intentionally *not* treated as known so the next sync can upgrade them.
    """
    return {
        r["match_id"]
        for r in conn.execute(
            "SELECT match_id FROM matches "
            "WHERE puuid = ? AND queue_id != 0 AND COALESCE(perf_ready, 0) = 1",
            (puuid,),
        )
    }


# Summoner's Rift 5v5 queues: normal draft, ranked solo, normal blind, ranked flex, quickplay
SR_QUEUES = {400, 420, 430, 440, 490}


def _team_totals(participants: list[dict], team_id) -> tuple[int, int]:
    kills = 0
    damage = 0
    for p in participants:
        if p.get("teamId") != team_id:
            continue
        kills += int(p.get("kills") or 0)
        damage += int(p.get("totalDamageDealtToChampions") or 0)
    return kills, damage


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
    duration_s = int(info.get("gameDuration") or 0)
    kills = int(me.get("kills") or 0)
    deaths = int(me.get("deaths") or 0)
    assists = int(me.get("assists") or 0)
    cs = int(me.get("totalMinionsKilled") or 0) + int(me.get("neutralMinionsKilled") or 0)
    vision_score = int(me.get("visionScore") or 0)
    damage_champions = int(me.get("totalDamageDealtToChampions") or 0)
    gold_earned = int(me.get("goldEarned") or 0)
    team_kills, team_damage = _team_totals(participants, me.get("teamId"))

    conn.execute(
        "INSERT INTO matches "
        "(puuid, match_id, my_champ, position, queue_id, win, played_at, "
        " duration_s, kills, deaths, assists, cs, vision_score, damage_champions, "
        " team_kills, team_damage, gold_earned, perf_ready) "
        "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1) "
        "ON CONFLICT(puuid, match_id) DO UPDATE SET "
        "my_champ = excluded.my_champ, "
        "position = excluded.position, "
        "queue_id = excluded.queue_id, "
        "win = excluded.win, "
        "played_at = excluded.played_at, "
        "duration_s = excluded.duration_s, "
        "kills = excluded.kills, "
        "deaths = excluded.deaths, "
        "assists = excluded.assists, "
        "cs = excluded.cs, "
        "vision_score = excluded.vision_score, "
        "damage_champions = excluded.damage_champions, "
        "team_kills = excluded.team_kills, "
        "team_damage = excluded.team_damage, "
        "gold_earned = excluded.gold_earned, "
        "perf_ready = 1",
        (
            puuid, match_id, my_champ, my_pos, queue_id, win, played_at,
            duration_s, kills, deaths, assists, cs, vision_score, damage_champions,
            team_kills, team_damage, gold_earned,
        ),
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
        "performance": performance_tracker(conn, puuid),
    }


def _avg(nums: list[float]) -> float | None:
    return round(sum(nums) / len(nums), 2) if nums else None


def _grade(value: float | None, baseline: float, *, higher_is_better: bool = True) -> str:
    """weak / ok / strong vs a soft role baseline."""
    if value is None or baseline <= 0:
        return "ok"
    ratio = value / baseline if higher_is_better else baseline / max(value, 0.01)
    if ratio < 0.85:
        return "weak"
    if ratio >= 1.1:
        return "strong"
    return "ok"


def _metric(key: str, label: str, value: float | None, baseline: float, unit: str, tip: str) -> dict:
    grade = _grade(value, baseline)
    return {
        "key": key,
        "label": label,
        "value": value,
        "baseline": baseline,
        "unit": unit,
        "grade": grade,
        "tip": tip,
    }


def performance_tracker(conn: sqlite3.Connection, puuid: str) -> dict:
    """op.gg-style personal habit tracker from synced Match-V5 rows (not scraped)."""
    rows = conn.execute(
        "SELECT position, duration_s, kills, deaths, assists, cs, vision_score, "
        "damage_champions, team_kills, team_damage "
        "FROM matches WHERE puuid = ? AND COALESCE(perf_ready, 0) = 1 AND duration_s >= 300",
        (puuid,),
    ).fetchall()

    pending = conn.execute(
        "SELECT COUNT(*) AS n FROM matches "
        "WHERE puuid = ? AND queue_id != 0 AND COALESCE(perf_ready, 0) = 0",
        (puuid,),
    ).fetchone()["n"]

    if not rows:
        return {
            "ready": False,
            "games": 0,
            "pending_upgrade": pending,
            "metrics": [],
            "focus": [],
            "by_role": [],
            "note": (
                "Hit Sync in Setup to pull CS, vision, and fight stats from your match history. "
                f"{pending} older games will upgrade on the next sync."
                if pending
                else "Hit Sync in Setup to pull CS, vision, and fight stats from your match history."
            ),
        }

    role_counts: dict[str, int] = {}
    for r in rows:
        pos = (r["position"] or "UNKNOWN").upper()
        role_counts[pos] = role_counts.get(pos, 0) + 1
    main_role = max(role_counts, key=role_counts.get)
    base = _ROLE_BASELINES.get(main_role, _ROLE_BASELINES["UNKNOWN"])

    cs_pm, vis_pm, kps, dmg_shares, kdas = [], [], [], [], []
    for r in rows:
        mins = max(r["duration_s"] / 60.0, 1.0)
        cs_pm.append(r["cs"] / mins)
        vis_pm.append(r["vision_score"] / mins)
        tk = r["team_kills"] or 0
        kps.append(((r["kills"] + r["assists"]) / tk) if tk else 0.0)
        td = r["team_damage"] or 0
        dmg_shares.append((r["damage_champions"] / td) if td else 0.0)
        kdas.append((r["kills"] + r["assists"]) / max(1, r["deaths"]))

    metrics = [
        _metric(
            "cs_per_min", "CS / min", _avg(cs_pm), base["cs_per_min"], "/m",
            "Farm pace vs a typical " + main_role.title() + " baseline.",
        ),
        _metric(
            "vision_per_min", "Vision / min", _avg(vis_pm), base["vision_per_min"], "/m",
            "Wards + vision score pace. Supports and junglers should lead here.",
        ),
        _metric(
            "kill_participation", "Kill participation",
            round((_avg(kps) or 0) * 100, 1),
            round(base["kp"] * 100, 1),
            "%",
            "Share of your team's kills you were in (kills + assists).",
        ),
        _metric(
            "damage_share", "Damage share",
            round((_avg(dmg_shares) or 0) * 100, 1),
            round(base["dmg_share"] * 100, 1),
            "%",
            "Your damage to champs as a % of your team's total.",
        ),
        _metric(
            "kda", "KDA", _avg(kdas), base["kda"], "",
            "Average (kills + assists) / deaths across synced games.",
        ),
    ]

    by_role = []
    for pos, count in sorted(role_counts.items(), key=lambda kv: -kv[1]):
        if count < 3:
            continue
        role_rows = [r for r in rows if (r["position"] or "UNKNOWN").upper() == pos]
        rb = _ROLE_BASELINES.get(pos, _ROLE_BASELINES["UNKNOWN"])
        r_cs = _avg([r["cs"] / max(r["duration_s"] / 60.0, 1.0) for r in role_rows])
        r_vis = _avg([r["vision_score"] / max(r["duration_s"] / 60.0, 1.0) for r in role_rows])
        r_kp = _avg([
            ((r["kills"] + r["assists"]) / r["team_kills"]) if r["team_kills"] else 0.0
            for r in role_rows
        ])
        r_dmg = _avg([
            (r["damage_champions"] / r["team_damage"]) if r["team_damage"] else 0.0
            for r in role_rows
        ])
        r_kda = _avg([
            (r["kills"] + r["assists"]) / max(1, r["deaths"]) for r in role_rows
        ])
        role_metrics = [
            _metric("cs_per_min", "CS / min", r_cs, rb["cs_per_min"], "/m", ""),
            _metric("vision_per_min", "Vision / min", r_vis, rb["vision_per_min"], "/m", ""),
            _metric(
                "kill_participation", "KP",
                round((r_kp or 0) * 100, 1), round(rb["kp"] * 100, 1), "%", "",
            ),
            _metric(
                "damage_share", "Dmg share",
                round((r_dmg or 0) * 100, 1), round(rb["dmg_share"] * 100, 1), "%", "",
            ),
            _metric("kda", "KDA", r_kda, rb["kda"], "", ""),
        ]
        weak = [m["key"] for m in role_metrics if m["grade"] == "weak"]
        by_role.append({
            "position": pos,
            "games": count,
            "metrics": role_metrics,
            "weak": weak,
        })

    focus = [m for m in metrics if m["grade"] == "weak"]
    note = (
        f"Graded vs soft {main_role.title()} baselines from your synced Riot history "
        f"({len(rows)} games). Same idea as op.gg habit tracking — your Match-V5 data, not scraped."
    )
    if pending:
        note += f" Sync again to upgrade {pending} older games missing these stats."

    return {
        "ready": True,
        "games": len(rows),
        "pending_upgrade": pending,
        "main_role": main_role,
        "metrics": metrics,
        "focus": focus,
        "by_role": by_role,
        "note": note,
    }


def latest_match_id(conn: sqlite3.Connection, puuid: str) -> str | None:
    """Most recent synced Summoner's Rift match for this account."""
    row = conn.execute(
        "SELECT match_id FROM matches "
        "WHERE puuid = ? AND queue_id != 0 "
        "ORDER BY played_at DESC, match_id DESC LIMIT 1",
        (puuid,),
    ).fetchone()
    return row["match_id"] if row else None


_QUEUE_LABELS = {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    490: "Quickplay",
}


def recent_match_list(conn: sqlite3.Connection, puuid: str, limit: int = 40) -> list[dict]:
    """Synced SR games newest-first — for the Postgame tab history (no Riot calls)."""
    rows = conn.execute(
        "SELECT match_id, my_champ, position, queue_id, win, played_at, "
        "duration_s, kills, deaths, assists, cs, COALESCE(perf_ready, 0) AS perf_ready "
        "FROM matches WHERE puuid = ? AND queue_id != 0 "
        "ORDER BY played_at DESC, match_id DESC LIMIT ?",
        (puuid, limit),
    ).fetchall()
    out = []
    for r in rows:
        qid = int(r["queue_id"] or 0)
        out.append({
            "match_id": r["match_id"],
            "champion": r["my_champ"],
            "position": r["position"],
            "queue_id": qid,
            "queue": _QUEUE_LABELS.get(qid, f"Queue {qid}"),
            "win": bool(r["win"]),
            "played_at": int(r["played_at"] or 0),
            "duration_s": int(r["duration_s"] or 0),
            "kills": int(r["kills"] or 0),
            "deaths": int(r["deaths"] or 0),
            "assists": int(r["assists"] or 0),
            "cs": int(r["cs"] or 0),
            "perf_ready": bool(r["perf_ready"]),
            "has_match_cache": store_has_match_cache(conn, r["match_id"]),
            "has_report_cache": store_has_report_cache(conn, puuid, r["match_id"]),
        })
    return out


def owns_match(conn: sqlite3.Connection, puuid: str, match_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM matches WHERE puuid = ? AND match_id = ?",
        (puuid, match_id),
    ).fetchone()
    return row is not None


def store_has_match_cache(conn: sqlite3.Connection, match_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM match_cache WHERE match_id = ?", (match_id,)
    ).fetchone()
    return row is not None


def store_has_report_cache(conn: sqlite3.Connection, puuid: str, match_id: str) -> bool:
    row = conn.execute(
        "SELECT 1 FROM postgame_reports WHERE puuid = ? AND match_id = ?",
        (puuid, match_id),
    ).fetchone()
    return row is not None


def get_timeline_payload(conn: sqlite3.Connection, match_id: str) -> dict | None:
    row = conn.execute(
        "SELECT payload FROM timeline_cache WHERE match_id = ?", (match_id,)
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def put_timeline_payload(conn: sqlite3.Connection, match_id: str, payload: dict) -> None:
    conn.execute(
        "INSERT INTO timeline_cache (match_id, payload, cached_at) VALUES (?, ?, ?) "
        "ON CONFLICT(match_id) DO NOTHING",
        (match_id, json.dumps(payload), int(time.time())),
    )
    conn.commit()


def get_postgame_report(conn: sqlite3.Connection, puuid: str, match_id: str) -> dict | None:
    row = conn.execute(
        "SELECT payload FROM postgame_reports WHERE puuid = ? AND match_id = ?",
        (puuid, match_id),
    ).fetchone()
    if not row:
        return None
    try:
        return json.loads(row["payload"])
    except json.JSONDecodeError:
        return None


def put_postgame_report(
    conn: sqlite3.Connection, puuid: str, match_id: str, report: dict
) -> None:
    conn.execute(
        "INSERT INTO postgame_reports (puuid, match_id, payload, cached_at) "
        "VALUES (?, ?, ?, ?) "
        "ON CONFLICT(puuid, match_id) DO UPDATE SET "
        "payload = excluded.payload, cached_at = excluded.cached_at",
        (puuid, match_id, json.dumps(report), int(time.time())),
    )
    conn.commit()


def champ_metric_avgs(conn: sqlite3.Connection, puuid: str, champ: str) -> dict:
    """Personal averages on a champion from synced perf-ready games."""
    rows = conn.execute(
        "SELECT duration_s, kills, deaths, assists, cs, vision_score, "
        "damage_champions, team_kills, team_damage "
        "FROM matches WHERE puuid = ? AND my_champ = ? "
        "AND COALESCE(perf_ready, 0) = 1 AND duration_s >= 300",
        (puuid, champ),
    ).fetchall()
    if not rows:
        return {"games": 0}
    cs_pm, vis_pm, kps, dmgs, kdas = [], [], [], [], []
    for r in rows:
        mins = max(r["duration_s"] / 60.0, 1.0)
        cs_pm.append(r["cs"] / mins)
        vis_pm.append(r["vision_score"] / mins)
        tk = r["team_kills"] or 0
        kps.append(((r["kills"] + r["assists"]) / tk) if tk else 0.0)
        td = r["team_damage"] or 0
        dmgs.append((r["damage_champions"] / td) if td else 0.0)
        kdas.append((r["kills"] + r["assists"]) / max(1, r["deaths"]))
    return {
        "games": len(rows),
        "cs_per_min": _avg(cs_pm),
        "vision_per_min": _avg(vis_pm),
        "kill_participation": round((_avg(kps) or 0) * 100, 1),
        "damage_share": round((_avg(dmgs) or 0) * 100, 1),
        "kda": _avg(kdas),
    }


def role_baseline(position: str) -> dict:
    pos = (position or "UNKNOWN").upper()
    return dict(_ROLE_BASELINES.get(pos, _ROLE_BASELINES["UNKNOWN"]))


def grade_value(value: float | None, baseline: float) -> str:
    return _grade(value, baseline)
