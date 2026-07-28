"""App settings. Riot API key is server-only — never returned to the browser or SQLite."""
from __future__ import annotations

import os
import re

# Invisible / quote junk that often rides along when copying from the Riot portal.
_KEY_NOISE = re.compile(r'[\ufeff\u200b\u200c\u200d\xa0"\']+')
# Portal pastes sometimes include line breaks or spaces inside the key.
_KEY_WHITESPACE = re.compile(r"\s+")
# If the clipboard has a label + key, keep from RGAPI- onward.
_RGAPI_START = re.compile(r"(RGAPI-[A-Za-z0-9-]+)")

# In-process only. Gone when uvicorn exits. Never written to disk.
_session_api_key: str | None = None


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


def normalize_api_key(raw: str) -> str:
    """Strip whitespace / copy-paste noise so a portal key is not rejected."""
    key = _KEY_NOISE.sub("", (raw or "").strip())
    key = _KEY_WHITESPACE.sub("", key)
    match = _RGAPI_START.search(key)
    if match:
        key = match.group(1)
    return key


def _is_placeholder_key(key: str) -> bool:
    return (not key) or key.startswith("RGAPI-your") or key == "RGAPI-"


def _env_api_key() -> str | None:
    key = normalize_api_key(os.environ.get("RIOT_API_KEY", ""))
    if _is_placeholder_key(key) or not key.startswith("RGAPI-"):
        return None
    return key


def set_session_api_key(raw: str) -> str:
    """Store a key in memory for this server process only."""
    global _session_api_key
    key = normalize_api_key(raw)
    if _is_placeholder_key(key) or not key.startswith("RGAPI-"):
        raise RuntimeError("Paste a real Riot API key (starts with RGAPI-).")
    _session_api_key = key
    return key


def clear_session_api_key() -> None:
    """Drop the in-memory session key (env key, if any, still applies)."""
    global _session_api_key
    _session_api_key = None


def current_api_key() -> str | None:
    """Session memory first, then ``RIOT_API_KEY`` from env. Never SQLite."""
    if _session_api_key:
        return _session_api_key
    return _env_api_key()


def key_source() -> str | None:
    if _session_api_key:
        return "session"
    if _env_api_key():
        return "env"
    return None
