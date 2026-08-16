"""Centralized server-side Riot API service.

All authenticated Riot web API calls should go through this module (or through
route handlers that call it). The API key is read only on the server — from an
in-memory session paste (Setup) or ``RIOT_API_KEY`` in the environment — never
from SQLite, and never returned to the browser.

Low-level HTTP lives in ``app.riot``; this module is the single entry point
used by feature routes and by ``/api/riot/*`` endpoints.
"""
from __future__ import annotations

import time

import httpx

from app import config, riot, store

# Avoid re-hitting Riot on every pill refresh / status poll.
_STATUS_TTL_S = 45.0
_status_cache: dict | None = None
_status_cached_at = 0.0


def has_api_key() -> bool:
    return config.current_api_key() is not None


def clear_key_status_cache() -> None:
    global _status_cache, _status_cached_at
    _status_cache = None
    _status_cached_at = 0.0


def seed_key_status_cache(*, valid: bool | None, source: str, warning: str | None = None) -> None:
    """Remember a just-checked result so the pill does not immediately re-hit Riot."""
    global _status_cache, _status_cached_at
    _status_cache = {
        "configured": True,
        "valid": valid,
        "source": source,
        "warning": warning,
    }
    _status_cached_at = time.monotonic()


def web_api(*, platform: bool = True) -> riot.RiotWebApi:
    """Build a RiotWebApi using current env region/platform."""
    if platform:
        return riot.RiotWebApi(config.region(), config.platform())
    return riot.RiotWebApi(config.region())


async def key_status(*, force: bool = False) -> dict:
    """Whether a server key is set and (if reachable) accepted by Riot."""
    global _status_cache, _status_cached_at

    key = config.current_api_key()
    if not key:
        clear_key_status_cache()
        return {"configured": False, "valid": None, "source": None, "warning": None}

    now = time.monotonic()
    if (
        not force
        and _status_cache is not None
        and _status_cache.get("source") == config.key_source()
        and now - _status_cached_at < _STATUS_TTL_S
    ):
        return dict(_status_cache)

    try:
        valid, warning = await riot.validate_key(key, config.platform())
    except Exception as e:
        valid, warning = None, f"Could not reach Riot to check the key ({e})."
    payload = {
        "configured": True,
        "valid": valid,
        "source": config.key_source(),
        "warning": warning,
    }
    _status_cache = dict(payload)
    _status_cached_at = now
    return payload


async def get_account(
    game_name: str,
    tag_line: str,
    client: httpx.AsyncClient | None = None,
) -> dict:
    return await web_api(platform=False).get_account(game_name, tag_line, client)


async def get_summoner_by_puuid(client: httpx.AsyncClient, puuid: str) -> dict:
    return await web_api().get_summoner_by_puuid(client, puuid)


async def get_league_entries(client: httpx.AsyncClient, puuid: str) -> list[dict]:
    entries = await web_api().get_league_entries(client, puuid)
    try:
        conn = store.connect()
        try:
            store.save_league_entries(conn, puuid, entries)
        finally:
            conn.close()
    except Exception:
        pass
    return entries


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
