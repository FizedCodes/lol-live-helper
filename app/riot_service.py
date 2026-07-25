"""Centralized server-side Riot API service.

All authenticated Riot web API calls should go through this module (or through
route handlers that call it). The API key is read only on the server — from an
in-memory session paste (Setup) or ``RIOT_API_KEY`` in the environment — never
from SQLite, and never returned to the browser.

Low-level HTTP lives in ``app.riot``; this module is the single entry point
used by feature routes and by ``/api/riot/*`` endpoints.
"""
from __future__ import annotations

import httpx

from app import config, riot


def has_api_key() -> bool:
    return config.current_api_key() is not None


def web_api(*, platform: bool = True) -> riot.RiotWebApi:
    """Build a RiotWebApi using current env region/platform."""
    if platform:
        return riot.RiotWebApi(config.region(), config.platform())
    return riot.RiotWebApi(config.region())


async def key_status() -> dict:
    """Whether a server key is set and (if reachable) accepted by Riot."""
    key = config.current_api_key()
    if not key:
        return {"configured": False, "valid": None, "source": None}
    try:
        valid = await riot.validate_key(key, config.platform())
    except Exception:
        valid = None
    return {"configured": True, "valid": valid, "source": config.key_source()}


async def get_account(
    game_name: str,
    tag_line: str,
    client: httpx.AsyncClient | None = None,
) -> dict:
    return await web_api(platform=False).get_account(game_name, tag_line, client)


async def get_summoner_by_puuid(client: httpx.AsyncClient, puuid: str) -> dict:
    return await web_api().get_summoner_by_puuid(client, puuid)


async def get_league_entries(client: httpx.AsyncClient, puuid: str) -> list[dict]:
    return await web_api().get_league_entries(client, puuid)


async def get_match_ids(
    puuid: str,
    count: int,
    client: httpx.AsyncClient | None = None,
    *,
    start_time: int | None = None,
) -> list[str]:
    return await web_api(platform=False).get_match_ids(
        puuid, count, client, start_time=start_time
    )


async def get_match(client: httpx.AsyncClient, match_id: str) -> dict | None:
    return await web_api(platform=False).get_match(client, match_id)


async def fetch_match(
    client: httpx.AsyncClient, match_id: str, *, retries: int = 3
) -> tuple[dict | None, str]:
    return await web_api().fetch_match(client, match_id, retries=retries)


async def fetch_timeline(
    client: httpx.AsyncClient, match_id: str, *, retries: int = 2
) -> tuple[dict | None, str]:
    return await web_api().fetch_timeline(client, match_id, retries=retries)


async def fetch_live_game() -> dict | None:
    """Local Live Client Data — no API key."""
    return await riot.fetch_live_game()
