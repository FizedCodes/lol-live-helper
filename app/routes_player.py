"""One-click / searchable player lookup via Riot Account + League-V4 + recent matches."""
from __future__ import annotations

import json
import time

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse, StreamingResponse
from pydantic import BaseModel, Field

from app import ranks, riot_service, store
from app.riot import RiotWebApi

router = APIRouter(prefix="/api")


class PlayerCacheClearIn(BaseModel):
    riot_id: str = Field(..., min_length=3)
    match_ids: list[str] = Field(default_factory=list)
# Newest match IDs kept for Load more (cheap: one list call).
MATCH_ID_INDEX = 70
# Details fetched per page (dev keys burn fast on Match-V5 detail).
PAGE_SIZE = 20
# Re-search same player within this window keeps ranks (solo/flex/level).
# Match-id lists are always re-pulled on first-page search so new games show up.
LOOKUP_TTL_SEC = 300
# Player history only cares about recent games — older than this are dropped.
HISTORY_MAX_AGE_SEC = 30 * 86400

# In-memory player lookup memory (this process only).
# key: canonical riot id lowercased → profile + match_ids + summary map
# Ranks stay warm for LOOKUP_TTL_SEC; match_ids refresh on every start=0 search.
_lookups: dict[str, dict] = {}

QUEUE_LABELS = {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    490: "Quickplay",
    700: "Clash",
    830: "Intro Bots",
    840: "Beginner Bots",
    850: "Intermediate Bots",
    890: "Intermediate Bots",
    900: "ARURF",
    1020: "One for All",
    1700: "Arena",
}

RANKED_QUEUE_IDS = {420, 440}
SR_QUEUE_IDS = {400, 420, 430, 440, 490}

# Rough ladder height for "high elo on a thin account" combos.
_TIER_HEIGHT = {
    "IRON": 0,
    "BRONZE": 1,
    "SILVER": 2,
    "GOLD": 3,
    "PLATINUM": 4,
    "EMERALD": 5,
    "DIAMOND": 6,
    "MASTER": 7,
    "GRANDMASTER": 8,
    "CHALLENGER": 9,
}


def _entry_summary(entry: dict | None, queue_label: str) -> dict | None:
    if not entry:
        return None
    wins = int(entry.get("wins") or 0)
    losses = int(entry.get("losses") or 0)
    games = wins + losses
    return {
        "queue": queue_label,
        "tier": entry.get("tier"),
        "division": entry.get("rank"),
        "lp": entry.get("leaguePoints", 0),
        "wins": wins,
        "losses": losses,
        "games": games,
        "win_rate": round(100.0 * wins / games, 1) if games else None,
    }


def _best_tier(solo: dict | None, flex: dict | None) -> tuple[str | None, int]:
    """Return (tier_name, height) for the higher of solo/flex."""
    best_tier, best_h = None, -1
    for entry in (solo, flex):
        if not entry or not entry.get("tier"):
            continue
        tier = str(entry["tier"]).upper()
        h = _TIER_HEIGHT.get(tier, -1)
        if h > best_h:
            best_tier, best_h = tier, h
    return best_tier, best_h


def _kda(m: dict) -> float:
    return (int(m.get("kills") or 0) + int(m.get("assists") or 0)) / max(1, int(m.get("deaths") or 0))


def _cs_per_min(m: dict) -> float | None:
    dur = int(m.get("duration") or 0)
    if dur < 300:
        return None
    return float(m.get("cs") or 0) / (dur / 60.0)


def _smurf_signal(
    level: int | None,
    ranked_games: int,
    recent: list[dict],
    solo: dict | None = None,
    flex: dict | None = None,
) -> dict:
    """Heuristic flags — not proof. Score weights so one soft flag alone rarely alarms."""
    flags: list[str] = []
    score = 0
    tier, tier_h = _best_tier(solo, flex)
    decided = [m for m in recent if m.get("win") is not None]
    ranked_recent = [m for m in decided if m.get("queue_id") in RANKED_QUEUE_IDS]
    sr_recent = [m for m in decided if m.get("queue_id") in SR_QUEUE_IDS]

    # --- Account freshness / ladder mismatch ---------------------------------
    if level is not None and level <= 40:
        flags.append(f"Summoner level {level} (low for a long-time account)")
        score += 2
    elif level is not None and level <= 55 and ranked_games < 80:
        flags.append(f"Level {level} with only {ranked_games} ranked games — still a young ladder account")
        score += 1

    if ranked_games == 0 and level is not None and level >= 30:
        flags.append("Level 30+ but no ranked games this season")
        score += 1
    elif ranked_games and ranked_games < 50:
        # Soft alone — strong when paired with high elo or low level.
        flags.append(f"Only {ranked_games} ranked games on record this season")
        score += 1

    if tier_h >= 5 and ranked_games < 60:  # Emerald+
        flags.append(
            f"{tier.title()} with only {ranked_games} ranked games — classic smurf / bought-boost ladder shape"
        )
        score += 3
    elif tier_h >= 6 and ranked_games < 100:  # Diamond+
        flags.append(f"{tier.title()} on a thin ranked sample ({ranked_games} games)")
        score += 2
    elif tier_h >= 4 and level is not None and level <= 45:  # Plat+ on low level
        flags.append(f"{tier.title()} at summoner level {level}")
        score += 3
    elif tier_h >= 3 and level is not None and level <= 35:  # Gold+ very fresh
        flags.append(f"{tier.title()} at summoner level {level}")
        score += 2

    # Season WR vs sample size (League entry wins/losses).
    for label, entry in (("Solo", solo), ("Flex", flex)):
        if not entry or not entry.get("games") or entry["games"] < 15:
            continue
        wr = entry.get("win_rate")
        if wr is not None and wr >= 65 and entry["games"] <= 60:
            flags.append(f"{wr:.0f}% {label} win rate over only {entry['games']} games")
            score += 2
        elif wr is not None and wr >= 70 and entry["games"] <= 100:
            flags.append(f"{wr:.0f}% {label} win rate over {entry['games']} games")
            score += 1

    # --- Recent activity patterns --------------------------------------------
    if len(decided) >= 5:
        wins = sum(1 for m in decided if m["win"])
        wr = 100.0 * wins / len(decided)
        if wr >= 75:
            flags.append(f"{wr:.0f}% win rate across last {len(decided)} games")
            score += 2
        elif wr >= 70:
            flags.append(f"{wr:.0f}% win rate across last {len(decided)} games")
            score += 1

    if len(ranked_recent) >= 6:
        rw = sum(1 for m in ranked_recent if m["win"])
        rwr = 100.0 * rw / len(ranked_recent)
        if rwr >= 75:
            flags.append(f"{rwr:.0f}% ranked win rate in last {len(ranked_recent)} ranked games")
            score += 2

    # Games-per-day over the span of the recent sample (smurf grind).
    stamps = sorted(int(m["played_at"]) for m in decided if m.get("played_at"))
    if len(stamps) >= 8:
        span_days = max((stamps[-1] - stamps[0]) / 86400.0, 0.5)
        gpd = len(stamps) / span_days
        if gpd >= 10:
            flags.append(f"Heavy grind — ~{gpd:.1f} games/day over the last {span_days:.1f} days")
            score += 2
        elif gpd >= 7:
            flags.append(f"High play volume — ~{gpd:.1f} games/day recently")
            score += 1

    # One-trick / tiny champ pool (smurfs often OTP).
    champs = [m.get("champion") for m in decided if m.get("champion")]
    if len(champs) >= 8:
        counts: dict[str, int] = {}
        for c in champs:
            counts[c] = counts.get(c, 0) + 1
        top_champ, top_n = max(counts.items(), key=lambda kv: kv[1])
        share = 100.0 * top_n / len(champs)
        unique = len(counts)
        if share >= 70:
            flags.append(f"OTP pattern — {top_champ} in {top_n}/{len(champs)} recent games ({share:.0f}%)")
            score += 2
        elif unique <= 3 and len(champs) >= 10:
            flags.append(f"Tiny champ pool — only {unique} champs in last {len(champs)} games")
            score += 1

    # Inflated KDA / CS (stomping below their real level).
    if len(decided) >= 8:
        avg_kda = sum(_kda(m) for m in decided) / len(decided)
        if avg_kda >= 5.5:
            flags.append(f"Inflated KDA — {avg_kda:.1f} average across last {len(decided)} games")
            score += 2
        elif avg_kda >= 4.5:
            flags.append(f"High KDA — {avg_kda:.1f} average across last {len(decided)} games")
            score += 1

    cs_samples = [_cs_per_min(m) for m in sr_recent]
    cs_samples = [x for x in cs_samples if x is not None]
    if len(cs_samples) >= 6:
        avg_cs = sum(cs_samples) / len(cs_samples)
        if avg_cs >= 8.5:
            flags.append(f"Very high CS pace — {avg_cs:.1f} CS/min in recent SR games")
            score += 1

    # Deduplicate flags while preserving order.
    seen: set[str] = set()
    uniq_flags = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            uniq_flags.append(f)

    if score >= 4:
        severity = "flagged"
        likely = True
        label = "Possible smurf / new account"
        note = "Several soft signals line up — treat as a heads-up, not proof."
    elif score >= 2:
        severity = "watch"
        likely = True
        label = "Worth a glance"
        note = "A couple of smurf-ish patterns — maybe skilled, maybe a second account."
    else:
        severity = "ok"
        likely = False
        label = "Looks normal"
        note = "No strong smurf signals from level, ladder volume, or recent play patterns."

    return {
        "level": level,
        "ranked_games": ranked_games,
        "tier": tier,
        "score": score,
        "severity": severity,
        "likely_smurf": likely,
        "label": label,
        "note": note,
        "flags": uniq_flags,
    }


def _played_at(info: dict) -> int:
    """Epoch seconds for when the game actually started (fallback: lobby create time)."""
    ms = info.get("gameStartTimestamp") or info.get("gameCreation") or 0
    return int(ms // 1000)


def _match_summary(match: dict, match_id: str, puuid: str) -> dict | None:
    info = match.get("info") or {}
    me = next((p for p in info.get("participants", []) if p.get("puuid") == puuid), None)
    if not me:
        return None
    queue_id = info.get("queueId")
    return {
        "match_id": match_id,
        "champion": me.get("championName"),
        "win": bool(me.get("win")),
        "kills": me.get("kills", 0),
        "deaths": me.get("deaths", 0),
        "assists": me.get("assists", 0),
        "cs": (me.get("totalMinionsKilled") or 0) + (me.get("neutralMinionsKilled") or 0),
        "damage": me.get("totalDamageDealtToChampions") or 0,
        "queue_id": queue_id,
        "queue": QUEUE_LABELS.get(queue_id, f"Queue {queue_id}"),
        "duration": info.get("gameDuration", 0),
        "played_at": _played_at(info),
    }


def _parse_riot_id(riot_id: str) -> tuple[str, str]:
    if "#" not in riot_id:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")
    name, tag = riot_id.split("#", 1)
    name, tag = name.strip(), tag.strip()
    if not name or not tag:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")
    if tag.upper() == "BOT" or name.lower().endswith(" bot"):
        raise HTTPException(
            status_code=400,
            detail="That looks like a co-op vs AI / practice bot, not a real player.",
        )
    return name, tag


def _cache_lookup_rank(canonical: str, summary_solo: dict | None, flex: dict | None) -> None:
    if summary_solo:
        ranks.cache_rank(canonical, {
            "tier": summary_solo["tier"],
            "division": summary_solo["division"],
            "lp": summary_solo["lp"],
            "queue": "Solo",
        })
    elif flex:
        ranks.cache_rank(canonical, {
            "tier": flex["tier"],
            "division": flex["rank"],
            "lp": flex["leaguePoints"],
            "queue": "Flex",
        })
    else:
        ranks.cache_rank(canonical, {"tier": None})


async def _fetch_match_cached(
    api: RiotWebApi,
    client: httpx.AsyncClient,
    match_id: str,
    conn=None,
) -> tuple[dict | None, str]:
    """Prefer SQLite match_cache; only hit Riot on a miss."""
    own = conn is None
    if own:
        conn = store.connect()
    try:
        hit = store.get_match_payload(conn, match_id)
        if hit is not None:
            return hit, "ok"
        match, status = await api.fetch_match(client, match_id)
        if status == "ok" and match is not None:
            store.put_match_payload(conn, match_id, match)
        return match, status
    finally:
        if own:
            conn.close()


def _lookup_key(canonical: str) -> str:
    return canonical.strip().lower()


def _get_lookup(canonical: str) -> dict | None:
    entry = _lookups.get(_lookup_key(canonical))
    if not entry:
        return None
    if entry["expires"] < time.time():
        _lookups.pop(_lookup_key(canonical), None)
        return None
    return entry


def _put_lookup(entry: dict) -> None:
    entry["expires"] = time.time() + LOOKUP_TTL_SEC
    key = _lookup_key(entry["riot_id"])
    _lookups[key] = entry


def _clear_lookup_memory(riot_id: str) -> tuple[list[str], bool]:
    """Drop in-memory lookup rows for this Riot ID. Returns (match_ids, found)."""
    target = _lookup_key(riot_id)
    match_ids: list[str] = []
    found = False
    for key, entry in list(_lookups.items()):
        rid = _lookup_key(entry.get("riot_id") or "")
        if key == target or rid == target:
            found = True
            match_ids.extend(entry.get("match_ids") or [])
            _lookups.pop(key, None)
    # Dedupe while preserving order
    seen: set[str] = set()
    uniq: list[str] = []
    for mid in match_ids:
        if mid and mid not in seen:
            seen.add(mid)
            uniq.append(mid)
    return uniq, found


def _history_cutoff() -> int:
    return int(time.time()) - HISTORY_MAX_AGE_SEC


def _summaries_in_id_order(entry: dict, start: int, count: int) -> list[dict]:
    """Stable newest-first order from Riot's id list (not a re-sort by clock)."""
    cutoff = _history_cutoff()
    rows: list[dict] = []
    for mid in entry["match_ids"][start:start + count]:
        row = entry["summaries"].get(mid)
        if not row:
            continue
        if int(row.get("played_at") or 0) < cutoff:
            continue
        rows.append(row)
    return rows


def _all_summaries_in_id_order(entry: dict) -> list[dict]:
    return _summaries_in_id_order(entry, 0, len(entry["match_ids"]))


def _ndjson(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":")) + "\n"


@router.get("/player")
async def lookup_player(
    riot_id: str = Query(..., min_length=3),
    stream: bool = Query(False, description="NDJSON progress events while matches load"),
    start: int = Query(0, ge=0, description="Match page offset for Load more"),
    count: int = Query(PAGE_SIZE, ge=1, le=50, description="Matches to load this page"),
    refresh: bool = Query(False, description="Ignore in-memory lookup and re-pull id list"),
):
    """Look up a player's ranked stats, smurf signals, and recent matches."""
    name, tag = _parse_riot_id(riot_id)
    typed = f"{name}#{tag}"
    api = riot_service.web_api()

    if refresh:
        _lookups.pop(_lookup_key(typed), None)

    cached = None if refresh else _get_lookup(typed)
    if cached:
        canonical = cached["riot_id"]
        puuid = cached["puuid"]
    else:
        try:
            account = await riot_service.get_account(name, tag)
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        canonical = f"{account['gameName']}#{account['tagLine']}"
        puuid = account["puuid"]
        if refresh:
            _lookups.pop(_lookup_key(canonical), None)

    if stream:
        return StreamingResponse(
            _player_stream(
                api, canonical, puuid,
                typed_key=typed, start=start, count=count, refresh=refresh,
            ),
            media_type="application/x-ndjson",
            headers={"Cache-Control": "no-store"},
        )

    async with httpx.AsyncClient(timeout=20.0) as client:
        events = [ev async for ev in _player_event_iter(
            api, client, canonical, puuid,
            typed_key=typed, start=start, count=count, refresh=refresh,
        )]
    err = next((e for e in events if e.get("type") == "error"), None)
    if err:
        raise HTTPException(status_code=400, detail=err.get("detail") or "Lookup failed.")
    done = next((e for e in events if e.get("type") == "done"), None)
    meta = next((e for e in events if e.get("type") == "meta"), None)
    if not done or not meta:
        raise HTTPException(status_code=400, detail="Lookup returned no data.")
    payload = {
        "riot_id": meta["riot_id"],
        "puuid": meta["puuid"],
        "solo": meta["solo"],
        "flex": meta["flex"],
        "summoner_level": meta["summoner_level"],
        "smurf": done["smurf"],
        "recent_matches": done["recent_matches"],
        "matches_warning": done.get("matches_warning"),
        "match_start": done.get("match_start", start),
        "match_count": done.get("match_count", count),
        "match_ids_total": done.get("match_ids_total", 0),
        "next_start": done.get("next_start", start + count),
        "has_more": done.get("has_more", False),
        "from_cache": done.get("from_cache", False),
        "ids_refreshed": done.get("ids_refreshed", False),
        "history_days": 30,
    }
    return JSONResponse(content=payload, headers={"Cache-Control": "no-store"})


@router.post("/player/cache/clear")
async def clear_player_cache(body: PlayerCacheClearIn):
    """Wipe in-memory lookup + SQLite match blobs for this player.

    `match_ids` is optional — when omitted we use whatever the in-memory index
    still knows. The Player tab sends ids from the open card as a backup.
    """
    name, tag = _parse_riot_id(body.riot_id.strip())
    typed = f"{name}#{tag}"

    mem_ids, found = _clear_lookup_memory(typed)
    match_ids: list[str] = []
    seen: set[str] = set()
    for mid in [*mem_ids, *[m for m in body.match_ids if m]]:
        if mid not in seen:
            seen.add(mid)
            match_ids.append(mid)

    deleted = 0
    if match_ids:
        conn = store.connect()
        try:
            deleted = store.delete_match_payloads(conn, match_ids)
        finally:
            conn.close()

    return {
        "ok": True,
        "riot_id": typed,
        "cleared_memory": found,
        "cleared_matches": deleted,
    }

async def _player_event_iter(
    api: RiotWebApi,
    client: httpx.AsyncClient,
    canonical: str,
    puuid: str,
    *,
    typed_key: str,
    start: int,
    count: int,
    refresh: bool = False,
):
    """Shared generator body for stream + JSON (yields event dicts)."""
    entry = None if refresh else (_get_lookup(canonical) or _get_lookup(typed_key))
    if entry is None:
        level = None
        try:
            summoner = await riot_service.get_summoner_by_puuid(client, puuid)
            level = summoner.get("summonerLevel")
        except Exception:
            level = None
        try:
            entries = await riot_service.get_league_entries(client, puuid)
        except Exception as e:
            yield {"type": "error", "detail": f"Could not fetch ranks: {e}"}
            return

        solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
        flex = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)
        summary_solo = _entry_summary(solo, "Solo")
        summary_flex = _entry_summary(flex, "Flex")
        _cache_lookup_rank(canonical, summary_solo, flex)
        ranked_games = (summary_solo["games"] if summary_solo else 0) + (
            summary_flex["games"] if summary_flex else 0
        )
        try:
            match_ids = await riot_service.get_match_ids(
                puuid, MATCH_ID_INDEX, client, start_time=_history_cutoff()
            )
        except Exception as e:
            yield {"type": "error", "detail": f"Could not load match list: {e}"}
            return
        entry = {
            "riot_id": canonical,
            "puuid": puuid,
            "solo": summary_solo,
            "flex": summary_flex,
            "summoner_level": level,
            "ranked_games": ranked_games,
            "match_ids": match_ids,
            "summaries": {},
            "fetched_through": 0,  # highest id-index we've attempted (+1)
        }
        _put_lookup(entry)
        _lookups[_lookup_key(typed_key)] = entry
        cached_hit = False
        ids_refreshed = True
    else:
        _put_lookup(entry)
        _lookups[_lookup_key(typed_key)] = entry
        summary_solo = entry["solo"]
        summary_flex = entry["flex"]
        level = entry["summoner_level"]
        ranked_games = entry["ranked_games"]
        cached_hit = True
        entry.setdefault("fetched_through", 0)
        ids_refreshed = False

        # Re-search (first page) always re-pulls the match-id list so a just-finished
        # game shows up. Ranks stay cached. Load more keeps the frozen list for stable paging.
        if start == 0:
            try:
                fresh_ids = await riot_service.get_match_ids(
                    puuid, MATCH_ID_INDEX, client, start_time=_history_cutoff()
                )
            except Exception as e:
                yield {"type": "error", "detail": f"Could not load match list: {e}"}
                return
            ids_refreshed = True
            if fresh_ids != entry.get("match_ids"):
                entry["match_ids"] = fresh_ids
                # Indexes shift when new games appear — reset the Load more cursor.
                entry["fetched_through"] = 0
                # Drop summaries for games that fell out of the window (optional tidy).
                keep = set(fresh_ids)
                entry["summaries"] = {
                    mid: row for mid, row in entry.get("summaries", {}).items() if mid in keep
                }
            _put_lookup(entry)

    id_total = len(entry["match_ids"])
    yield {
        "type": "meta",
        "riot_id": canonical,
        "puuid": puuid,
        "solo": summary_solo,
        "flex": summary_flex,
        "summoner_level": level,
        "from_cache": cached_hit,
        "ids_refreshed": ids_refreshed,
        "match_ids_total": id_total,
        "history_days": 30,
    }

    if id_total == 0:
        yield {
            "type": "done",
            "smurf": _smurf_signal(level, ranked_games, [], summary_solo, summary_flex),
            "recent_matches": [],
            "page_matches": [],
            "matches_warning": "No games in the last 30 days.",
            "match_start": start,
            "match_count": count,
            "match_ids_total": 0,
            "next_start": 0,
            "has_more": False,
            "from_cache": cached_hit,
            "ids_refreshed": ids_refreshed,
        }
        return

    page_ids = entry["match_ids"][start:start + count]
    total = len(page_ids)
    yield {"type": "progress", "done": 0, "total": total}

    page_rows: list[dict] = []
    warning = None
    cutoff = _history_cutoff()
    conn = store.connect()
    try:
        for i, match_id in enumerate(page_ids, start=1):
            if match_id in entry["summaries"]:
                row = entry["summaries"][match_id]
                if int(row.get("played_at") or 0) >= cutoff:
                    page_rows.append(row)
                    yield {"type": "match", "match": row, "cached": True}
                yield {"type": "progress", "done": i, "total": total}
                continue

            match, status = await _fetch_match_cached(api, client, match_id, conn)
            if status == "rate_limited":
                warning = (
                    "Riot rate-limited mid-lookup — showing partial history. "
                    "Wait ~2 minutes and search again (cached games stay free)."
                )
                yield {"type": "progress", "done": i - 1, "total": total}
                break
            if status != "missing" and match is not None:
                row = _match_summary(match, match_id, puuid)
                if row:
                    entry["summaries"][match_id] = row
                    if int(row.get("played_at") or 0) >= cutoff:
                        page_rows.append(row)
                        yield {"type": "match", "match": row, "cached": False}
            yield {"type": "progress", "done": i, "total": total}
    finally:
        conn.close()

    # Advance cursor by id-list index, not by how many summaries succeeded.
    entry["fetched_through"] = max(entry.get("fetched_through", 0), start + len(page_ids))
    _put_lookup(entry)

    all_rows = _all_summaries_in_id_order(entry)
    # UI list for this response:
    # - first page (start=0): everything loaded so far in id order (stable growth)
    # - load more: only this page (frontend appends)
    if start == 0:
        display_rows = all_rows
    else:
        display_rows = page_rows

    next_start = start + len(page_ids)
    has_more = next_start < id_total and warning is None

    yield {
        "type": "done",
        "smurf": _smurf_signal(level, ranked_games, all_rows, summary_solo, summary_flex),
        "recent_matches": display_rows,
        "page_matches": page_rows,
        "matches_warning": warning,
        "match_start": start,
        "match_count": count,
        "match_ids_total": id_total,
        "next_start": next_start,
        "has_more": has_more,
        "from_cache": cached_hit,
        "ids_refreshed": ids_refreshed,
        "history_days": 30,
    }


async def _player_stream(
    api: RiotWebApi,
    canonical: str,
    puuid: str,
    *,
    typed_key: str,
    start: int = 0,
    count: int = PAGE_SIZE,
    refresh: bool = False,
):
    """Yield NDJSON: meta → progress/match… → done (or error)."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            async for ev in _player_event_iter(
                api, client, canonical, puuid,
                typed_key=typed_key, start=start, count=count, refresh=refresh,
            ):
                yield _ndjson(ev)
    except Exception as e:
        yield _ndjson({"type": "error", "detail": str(e)})
