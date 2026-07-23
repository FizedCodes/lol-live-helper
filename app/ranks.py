"""Rank lookups for players in the live game, via League-V4."""
from __future__ import annotations

import asyncio

import httpx

from app import config, riot

# Ranks don't change mid-game, so cache lookups for the server's lifetime
_cache: dict[str, dict | None] = {}


def cache_rank(riot_id: str, rank: dict | None) -> None:
    """Seed the cache (e.g. after a manual player lookup)."""
    _cache[riot_id] = rank


async def fetch_ranks(riot_ids: list[str]) -> dict[str, dict | None]:
    """Resolve each Riot ID to its ranked entry (solo queue preferred, else flex)."""
    try:
        api = riot.RiotWebApi(config.region(), config.platform())
    except RuntimeError:
        return {}  # no API key: skip ranks, the rest of the live view still works

    async def one(client: httpx.AsyncClient, rid: str) -> tuple[str, dict | None]:
        if rid in _cache:
            return rid, _cache[rid]
        try:
            name, tag = rid.split("#", 1)
            # Shared Riot rate limiter spaces these out; gather just pipelines the waits.
            account = await api.get_account(name, tag, client)
            entries = await api.get_league_entries(client, account["puuid"])
            solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
            flex = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)
            entry = solo or flex
            rank = (
                {
                    "tier": entry["tier"],
                    "division": entry["rank"],
                    "lp": entry["leaguePoints"],
                    "queue": "Solo" if entry is solo else "Flex",
                }
                if entry
                else {"tier": None}  # verified player, just unranked
            )
        except Exception:
            return rid, None  # lookup failed (rate limit, expired key, ...): show nothing
        _cache[rid] = rank
        return rid, rank

    valid = [r for r in riot_ids if r and "#" in r]
    async with httpx.AsyncClient(timeout=10.0) as client:
        results = await asyncio.gather(*(one(client, r) for r in valid))
    return dict(results)
