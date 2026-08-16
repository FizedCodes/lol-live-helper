"""LP gained/lost on ranked games, from League-V4 snapshots.

Match-V5 has no LP field. Sites like op.gg poll ranks over time and attach the
change to the game in between. We do the same with snapshots taken during live
lobbies and Player lookups — only when exactly one ranked game of that queue
sits between two snapshots.
"""
from __future__ import annotations

from app import store

QUEUE_ID_TO_TYPE = {
    420: "RANKED_SOLO_5x5",
    440: "RANKED_FLEX_SR",
}

_TIER_BASE = {
    "IRON": 0,
    "BRONZE": 400,
    "SILVER": 800,
    "GOLD": 1200,
    "PLATINUM": 1600,
    "EMERALD": 2000,
    "DIAMOND": 2400,
}
_DIV = {"IV": 0, "III": 1, "II": 2, "I": 3}
_APEX = {"MASTER", "GRANDMASTER", "CHALLENGER"}
_APEX_HEIGHT = {"MASTER": 0, "GRANDMASTER": 1, "CHALLENGER": 2}

# League-V4 can lag a bit after the nexus falls.
_END_SLACK_SEC = 180


def abs_lp(tier: str | None, division: str | None, lp: int) -> int | None:
    """Linear Iron–Diamond scale (100 LP per division). Apex tiers are not comparable this way."""
    t = (tier or "").upper()
    if t in _APEX or t not in _TIER_BASE:
        return None
    d = _DIV.get((division or "").upper(), 0)
    return _TIER_BASE[t] + d * 100 + int(lp or 0)


def delta_between(before: dict, after: dict) -> dict | None:
    """Compare two snapshots. Returns lp_delta (int | None) and lp_event."""
    bt = (before.get("tier") or "").upper()
    at = (after.get("tier") or "").upper()
    if not bt or not at:
        return None

    b_apex = bt in _APEX
    a_apex = at in _APEX
    if b_apex or a_apex:
        if bt != at:
            bh = _APEX_HEIGHT.get(bt, -1)
            ah = _APEX_HEIGHT.get(at, -1)
            if bh < 0 or ah < 0:
                return None
            event = "promoted" if ah > bh else "demoted"
            return {"lp_delta": None, "lp_event": event}
        return {
            "lp_delta": int(after.get("lp") or 0) - int(before.get("lp") or 0),
            "lp_event": None,
        }

    b_abs = abs_lp(bt, before.get("division"), int(before.get("lp") or 0))
    a_abs = abs_lp(at, after.get("division"), int(after.get("lp") or 0))
    if b_abs is None or a_abs is None:
        return None
    delta = a_abs - b_abs

    event = None
    b_div = (before.get("division") or "").upper()
    a_div = (after.get("division") or "").upper()
    if (bt, b_div) != (at, a_div):
        event = "promoted" if delta > 0 else "demoted" if delta < 0 else None
    if delta == 0 and after.get("mini_series"):
        event = "promo"

    return {"lp_delta": delta, "lp_event": event}


def _ended_at(match: dict) -> int:
    return int(match.get("played_at") or 0) + int(match.get("duration") or 0)


def attach_lp_deltas(
    matches: list[dict],
    snapshots_by_queue: dict[str, list[dict]],
) -> None:
    """Mutate ranked match dicts with lp_delta / lp_event when we can prove it."""
    for match in matches:
        match.pop("lp_delta", None)
        match.pop("lp_event", None)

    by_queue: dict[str, list[dict]] = {q: [] for q in QUEUE_ID_TO_TYPE.values()}
    for match in matches:
        qtype = QUEUE_ID_TO_TYPE.get(int(match.get("queue_id") or 0))
        if not qtype:
            continue
        if match.get("remake") or int(match.get("duration") or 0) < 300:
            match["lp_delta"] = 0
            match["lp_event"] = "remake"
            continue
        by_queue[qtype].append(match)

    for qtype, rows in by_queue.items():
        _assign_queue(rows, snapshots_by_queue.get(qtype) or [])


def _assign_queue(matches: list[dict], snaps: list[dict]) -> None:
    if len(snaps) < 2 or not matches:
        return
    assigned: set[str] = set()
    for i in range(len(snaps) - 1):
        before, after = snaps[i], snaps[i + 1]
        dw = int(after["wins"]) - int(before["wins"])
        dl = int(after["losses"]) - int(before["losses"])
        if dw < 0 or dl < 0:
            continue  # season / split reset
        if dw + dl != 1:
            continue
        won = dw == 1
        info = delta_between(before, after)
        if info is None:
            continue

        t0 = int(before["captured_at"])
        t1 = int(after["captured_at"])
        candidates: list[dict] = []
        for match in matches:
            mid = match.get("match_id")
            if not mid or mid in assigned:
                continue
            if bool(match.get("win")) != won:
                continue
            start = int(match.get("played_at") or 0)
            end = _ended_at(match)
            # Snapshot during the game: t0 is between start and end.
            # Snapshot after previous game: t0 <= start. Either way the game
            # overlaps (t0, t1].
            if start < t1 and end > t0 and end <= t1 + _END_SLACK_SEC:
                candidates.append(match)

        if len(candidates) != 1:
            continue
        match = candidates[0]
        assigned.add(match["match_id"])
        match["lp_delta"] = info["lp_delta"]
        if info.get("lp_event"):
            match["lp_event"] = info["lp_event"]


def _summary_as_entry(summary: dict | None, queue_type: str) -> dict | None:
    if not summary or not summary.get("tier"):
        return None
    series = None
    if summary.get("mini_progress"):
        series = {"progress": summary["mini_progress"]}
    elif summary.get("promo"):
        series = {"progress": ""}
    return {
        "queueType": queue_type,
        "tier": summary.get("tier"),
        "rank": summary.get("division"),
        "leaguePoints": int(summary.get("lp") or 0),
        "wins": int(summary.get("wins") or 0),
        "losses": int(summary.get("losses") or 0),
        "miniSeries": series,
    }


def attach_match_lp(
    matches: list[dict],
    puuid: str,
    solo: dict | None,
    flex: dict | None,
) -> None:
    """Save current ranks, load snapshot history, fill LP on ranked match rows."""
    if not puuid:
        return
    conn = None
    try:
        conn = store.connect()
        entries = [
            e for e in (
                _summary_as_entry(solo, "RANKED_SOLO_5x5"),
                _summary_as_entry(flex, "RANKED_FLEX_SR"),
            ) if e
        ]
        if entries:
            store.save_league_entries(conn, puuid, entries)
        snaps = {
            q: store.list_rank_snapshots(conn, puuid, q)
            for q in QUEUE_ID_TO_TYPE.values()
        }
    except Exception:
        return
    finally:
        if conn is not None:
            conn.close()
    attach_lp_deltas(matches, snaps)
