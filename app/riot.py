"""Riot API clients: the local Live Client Data API and the web API (Account-V1 / Match-V5)."""
from __future__ import annotations

import httpx

LIVE_CLIENT_URL = "https://127.0.0.1:2999/liveclientdata/allgamedata"

# Platform-agnostic regional hosts used by Account-V1 and Match-V5
REGIONAL_HOSTS = {
    "americas": "https://americas.api.riotgames.com",
    "europe": "https://europe.api.riotgames.com",
    "asia": "https://asia.api.riotgames.com",
    "sea": "https://sea.api.riotgames.com",
}

# Platform-specific hosts used by League-V4 (ranks)
PLATFORMS = {
    "na1", "br1", "la1", "la2", "euw1", "eun1", "tr1", "ru", "me1",
    "kr", "jp1", "oc1", "sg2", "tw2", "vn2",
}


def _api_key() -> str:
    from app.config import current_api_key

    key = current_api_key()
    if not key:
        raise RuntimeError("No Riot API key configured. Paste one in the Setup panel on the dashboard.")
    return key


async def validate_key(key: str, platform: str) -> bool:
    """Cheap check that a key is alive: the status endpoint costs one request."""
    url = f"{platform_host(platform)}/lol/status/v4/platform-data"
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, headers={"X-Riot-Token": key})
        return resp.status_code == 200


def regional_host(region: str) -> str:
    try:
        return REGIONAL_HOSTS[region.lower()]
    except KeyError:
        raise RuntimeError(f"Unknown region '{region}'. Use one of: {', '.join(REGIONAL_HOSTS)}")


def platform_host(platform: str) -> str:
    p = platform.lower()
    if p not in PLATFORMS:
        raise RuntimeError(f"Unknown platform '{platform}'. Use one of: {', '.join(sorted(PLATFORMS))}")
    return f"https://{p}.api.riotgames.com"


async def fetch_live_game() -> dict | None:
    """Return live game data from the League client, or None when not in a game.

    The client serves this on localhost with a self-signed cert, hence verify=False.
    """
    try:
        async with httpx.AsyncClient(verify=False, timeout=3.0) as client:
            resp = await client.get(LIVE_CLIENT_URL)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, OSError):
        return None


def _check_key_rejection(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        raise RuntimeError(
            "Riot rejected the API key (expired or invalid). Dev keys expire every 24h — "
            "regenerate at developer.riotgames.com, update .env, and restart the server."
        )


class RiotWebApi:
    def __init__(self, region: str, platform: str | None = None):
        self.host = regional_host(region)
        self.platform = platform_host(platform) if platform else None
        self.headers = {"X-Riot-Token": _api_key()}

    async def get_league_entries(self, client: httpx.AsyncClient, puuid: str) -> list[dict]:
        """Ranked entries (solo/flex) for a player. Requires a platform (e.g. na1)."""
        url = f"{self.platform}/lol/league/v4/entries/by-puuid/{puuid}"
        resp = await client.get(url, headers=self.headers)
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json()

    async def get_account(self, game_name: str, tag_line: str) -> dict:
        """Verify a Riot ID exists and return the account (canonical gameName/tagLine + puuid)."""
        url = f"{self.host}/riot/account/v1/accounts/by-riot-id/{game_name}/{tag_line}"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers=self.headers)
            _check_key_rejection(resp)
            if resp.status_code == 404:
                raise RuntimeError(
                    f"No player found with Riot ID {game_name}#{tag_line}. "
                    "Check the spelling — the tagline is the part after the # on your profile."
                )
            resp.raise_for_status()
            return resp.json()

    async def get_match_ids(self, puuid: str, count: int) -> list[str]:
        ids: list[str] = []
        async with httpx.AsyncClient(timeout=10.0) as client:
            start = 0
            while start < count:
                batch = min(100, count - start)
                url = f"{self.host}/lol/match/v5/matches/by-puuid/{puuid}/ids"
                resp = await client.get(
                    url,
                    headers=self.headers,
                    params={"start": start, "count": batch},
                )
                _check_key_rejection(resp)
                resp.raise_for_status()
                page = resp.json()
                ids.extend(page)
                if len(page) < batch:
                    break
                start += batch
        return ids

    async def get_match(self, client: httpx.AsyncClient, match_id: str) -> dict | None:
        url = f"{self.host}/lol/match/v5/matches/{match_id}"
        resp = await client.get(url, headers=self.headers)
        if resp.status_code == 429:
            return None  # rate limited; caller decides how to wait
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json()
