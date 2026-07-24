"""App settings. The API key can come from the site (stored in the DB) or from .env."""
from __future__ import annotations

import os

from app import store


def region() -> str:
    return os.environ.get("RIOT_REGION", "americas")


def platform() -> str:
    return os.environ.get("RIOT_PLATFORM", "na1")


def sync_match_count() -> int:
    # Personal Sync index — enough for habits/matchups without chewing the whole season.
    return int(os.environ.get("SYNC_MATCH_COUNT", "250"))


# Stay under Riot personal-key defaults (20/1s, 100/2min) with a little headroom.
def riot_rate_limit_short() -> int:
    return int(os.environ.get("RIOT_RATE_LIMIT_SHORT", "18"))


def riot_rate_limit_short_window() -> float:
    return float(os.environ.get("RIOT_RATE_LIMIT_SHORT_WINDOW", "1"))


def riot_rate_limit_long() -> int:
    return int(os.environ.get("RIOT_RATE_LIMIT_LONG", "90"))


def riot_rate_limit_long_window() -> float:
    return float(os.environ.get("RIOT_RATE_LIMIT_LONG_WINDOW", "120"))


def _env_key() -> str | None:
    key = os.environ.get("RIOT_API_KEY", "").strip()
    if not key or key.startswith("RGAPI-your"):
        return None
    return key


def current_api_key() -> str | None:
    """The key saved from the site wins; .env is the fallback."""
    conn = store.connect()
    try:
        return store.get_meta(conn, "api_key") or _env_key()
    finally:
        conn.close()


def key_source() -> str | None:
    conn = store.connect()
    try:
        if store.get_meta(conn, "api_key"):
            return "site"
    finally:
        conn.close()
    return "env" if _env_key() else None


def save_api_key(key: str) -> None:
    conn = store.connect()
    try:
        store.set_meta(conn, "api_key", key.strip())
    finally:
        conn.close()
