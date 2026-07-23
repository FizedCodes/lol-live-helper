"""One-click / searchable player lookup via Riot Account + League-V4 + recent matches."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from app import config, ranks, riot

router = APIRouter(prefix="/api")

QUEUE_LABELS = {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    490: "Quickplay",
    700: "Clash",
    1700: "Arena",
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


def _smurf_signal(level: int | None, ranked_games: int, recent: list[dict]) -> dict:
    """Heuristic flags — not proof, just signals worth noticing."""
    flags = []
    if level is not None and level <= 40:
        flags.append(f"Summoner level {level} (low for a long-time account)")
    if ranked_games and ranked_games < 50:
        flags.append(f"Only {ranked_games} ranked games on record this season")
    if ranked_games == 0 and level is not None and level >= 30:
        flags.append("Level 30+ but no ranked games this season")

    # High win rate on a tiny recent sample can look smurfy / boosted.
    decided = [m for m in recent if m.get("win") is not None]
    if len(decided) >= 5:
        wins = sum(1 for m in decided if m["win"])
        wr = 100.0 * wins / len(decided)
        if wr >= 70:
            flags.append(f"{wr:.0f}% win rate across last {len(decided)} games")

    if not flags:
        return {
            "level": level,
            "ranked_games": ranked_games,
            "likely_smurf": False,
            "label": "Looks normal",
            "note": "No strong smurf signals from level / ranked volume / recent WR.",
            "flags": [],
        }
    return {
        "level": level,
        "ranked_games": ranked_games,
        "likely_smurf": True,
        "label": "Possible smurf / new account",
        "note": "These are soft signals only — high rank on a fresh account is the classic pattern.",
        "flags": flags,
    }


async def _recent_matches(api: riot.RiotWebApi, client: httpx.AsyncClient, puuid: str, count: int = 8) -> list[dict]:
    try:
        ids = await api.get_match_ids(puuid, count)
    except Exception:
        return []

    out = []
    for match_id in ids:
        match = await api.get_match(client, match_id)
        if match is None:
            break  # rate limited — return what we have
        info = match.get("info") or {}
        me = next((p for p in info.get("participants", []) if p.get("puuid") == puuid), None)
        if not me:
            continue
        queue_id = info.get("queueId")
        out.append({
            "match_id": match_id,
            "champion": me.get("championName"),
            "win": bool(me.get("win")),
            "kills": me.get("kills", 0),
            "deaths": me.get("deaths", 0),
            "assists": me.get("assists", 0),
            "cs": (me.get("totalMinionsKilled") or 0) + (me.get("neutralMinionsKilled") or 0),
            "queue_id": queue_id,
            "queue": QUEUE_LABELS.get(queue_id, f"Queue {queue_id}"),
            "duration": info.get("gameDuration", 0),
            "played_at": int((info.get("gameCreation") or 0) // 1000),
        })
    return out


@router.get("/player")
async def lookup_player(riot_id: str = Query(..., min_length=3)):
    """Look up a player's ranked stats, smurf signals, and recent matches."""
    if "#" not in riot_id:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")
    name, tag = riot_id.split("#", 1)
    name, tag = name.strip(), tag.strip()
    if not name or not tag:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")

    try:
        api = riot.RiotWebApi(config.region(), config.platform())
        account = await api.get_account(name, tag)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    canonical = f"{account['gameName']}#{account['tagLine']}"
    puuid = account["puuid"]

    level = None
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            try:
                summoner = await api.get_summoner_by_puuid(client, puuid)
                level = summoner.get("summonerLevel")
            except Exception:
                level = None
            try:
                entries = await api.get_league_entries(client, puuid)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not fetch ranks: {e}")
            recent = await _recent_matches(api, client, puuid, count=8)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
    flex = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)
    summary_solo = _entry_summary(solo, "Solo")
    summary_flex = _entry_summary(flex, "Flex")

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

    ranked_games = (summary_solo["games"] if summary_solo else 0) + (
        summary_flex["games"] if summary_flex else 0
    )

    return {
        "riot_id": canonical,
        "puuid": puuid,
        "solo": summary_solo,
        "flex": summary_flex,
        "summoner_level": level,
        "smurf": _smurf_signal(level, ranked_games, recent),
        "recent_matches": recent,
    }
