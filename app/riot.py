"""Riot API clients: the local Live Client Data API and the web API (Account-V1 / Match-V5)."""
from __future__ import annotations

import asyncio
from urllib.parse import quote

import httpx

from app.rate_limit import get_limiter

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
        raise RuntimeError(
            "No Riot API key configured. Paste one in Setup for this session, "
            "or set RIOT_API_KEY in .env and restart."
        )
    return key


async def validate_key(key: str, platform: str) -> tuple[bool | None, str | None]:
    """Check that a key is alive via the platform status endpoint.

    Returns ``(valid, warning)``:
    - ``(True, None)`` — Riot accepted the key
    - ``(False, None)`` — 401/403 rejected (expired / invalid)
    - ``(None, msg)`` — could not confirm (429 / network / other); caller may
      still accept a user paste so Setup is not blocked by a burned quota

    Does **not** use the shared Sync rate limiter — key paste must not queue
    behind live rank lookups. Status-V4 still counts toward Riot's app quota.
    """
    url = f"{platform_host(platform)}/lol/status/v4/platform-data"
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, headers={"X-Riot-Token": key})
    except (httpx.HTTPError, OSError) as e:
        return None, f"Could not reach Riot to check the key ({e}). Key can still be used."

    if resp.status_code == 200:
        return True, None
    if resp.status_code in (401, 403):
        return False, None
    if resp.status_code == 429:
        retry = resp.headers.get("Retry-After")
        wait_bit = f" Wait ~{retry}s." if retry else " Wait about a minute."
        return None, (
            "Riot rate-limited the key check (quota was likely burned by live "
            f"rank retries).{wait_bit} Key saved for this session anyway."
        )
    return None, (
        f"Could not confirm the key (Riot returned {resp.status_code}). "
        "Key saved for this session — try Check key status in a moment."
    )


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
    Connect timeout is short so /api/live stays snappy when League isn't running
    (otherwise every poll waits the full request timeout on a closed :2999).
    """
    try:
        timeout = httpx.Timeout(1.5, connect=0.4)
        async with httpx.AsyncClient(verify=False, timeout=timeout) as client:
            resp = await client.get(LIVE_CLIENT_URL)
            resp.raise_for_status()
            return resp.json()
    except (httpx.HTTPError, OSError):
        return None


def _check_key_rejection(resp: httpx.Response) -> None:
    if resp.status_code in (401, 403):
        raise RuntimeError(
            "Riot rejected the API key (expired or invalid). Dev keys expire every 24h — "
            "regenerate at developer.riotgames.com, then paste it in Setup (this session) "
            "or update RIOT_API_KEY in .env and restart."
        )


class RiotWebApi:
    def __init__(self, region: str, platform: str | None = None):
        self.host = regional_host(region)
        self.platform = platform_host(platform) if platform else None
        # Key is read fresh on every request via _headers() / current_api_key().

    def _headers(self) -> dict[str, str]:
        return {"X-Riot-Token": _api_key()}

    async def _get(
        self,
        client: httpx.AsyncClient | None,
        url: str,
        *,
        params: dict | None = None,
        retries: int = 3,
    ) -> httpx.Response:
        """Rate-limited GET against Riot. Retries on 429 using Retry-After when present."""
        limiter = get_limiter()

        async def _once(c: httpx.AsyncClient) -> httpx.Response:
            last: httpx.Response | None = None
            for attempt in range(retries):
                await limiter.acquire()
                resp = await c.get(url, headers=self._headers(), params=params)
                if resp.status_code != 429:
                    return resp
                last = resp
                raw = resp.headers.get("Retry-After")
                try:
                    wait = float(raw) if raw is not None else 1.5 * (attempt + 1)
                except ValueError:
                    wait = 1.5 * (attempt + 1)
                await asyncio.sleep(min(max(wait, 0.5), 30.0))
            assert last is not None
            return last

        if client is not None:
            return await _once(client)
        async with httpx.AsyncClient(timeout=12.0) as owned:
            return await _once(owned)

    async def get_league_entries(self, client: httpx.AsyncClient, puuid: str) -> list[dict]:
        """Ranked entries (solo/flex) for a player. Requires a platform (e.g. na1)."""
        url = f"{self.platform}/lol/league/v4/entries/by-puuid/{puuid}"
        resp = await self._get(client, url)
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json()

    async def get_summoner_by_puuid(self, client: httpx.AsyncClient, puuid: str) -> dict:
        """Summoner profile (level, icon). Requires a platform (e.g. na1)."""
        url = f"{self.platform}/lol/summoner/v4/summoners/by-puuid/{puuid}"
        resp = await self._get(client, url)
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json()

    async def get_account(
        self,
        game_name: str,
        tag_line: str,
        client: httpx.AsyncClient | None = None,
    ) -> dict:
        """Verify a Riot ID exists and return the account (canonical gameName/tagLine + puuid)."""
        url = (
            f"{self.host}/riot/account/v1/accounts/by-riot-id/"
            f"{quote(game_name, safe='')}/{quote(tag_line, safe='')}"
        )
        resp = await self._get(client, url)
        _check_key_rejection(resp)
        if resp.status_code == 404:
            raise RuntimeError(
                f"No player found with Riot ID {game_name}#{tag_line}. "
                "Check the spelling — the tagline is the part after the # on your profile."
            )
        resp.raise_for_status()
        return resp.json()

    async def get_match_ids(
        self,
        puuid: str,
        count: int,
        client: httpx.AsyncClient | None = None,
        *,
        start_time: int | None = None,
    ) -> list[str]:
        """Newest-first match IDs. Uses the shared rate limiter (and 429 retries)."""
        ids: list[str] = []
        start = 0
        while start < count:
            batch = min(100, count - start)
            url = f"{self.host}/lol/match/v5/matches/by-puuid/{puuid}/ids"
            params: dict = {"start": start, "count": batch}
            if start_time is not None:
                params["startTime"] = start_time
            resp = await self._get(client, url, params=params)
            if resp.status_code == 429:
                raise RuntimeError(
                    "Riot rate-limited the match list request. Wait ~2 minutes and try again "
                    "(dev keys allow 100 requests / 2 min)."
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
        """Return match JSON, or None when still rate-limited after retries."""
        url = f"{self.host}/lol/match/v5/matches/{match_id}"
        resp = await self._get(client, url)
        if resp.status_code == 429:
            return None
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json()

    async def fetch_match(
        self, client: httpx.AsyncClient, match_id: str, *, retries: int = 3
    ) -> tuple[dict | None, str]:
        """Fetch one match.

        Returns (match, status) where status is 'ok', 'missing', or 'rate_limited'.
        """
        url = f"{self.host}/lol/match/v5/matches/{match_id}"
        resp = await self._get(client, url, retries=retries)
        if resp.status_code == 429:
            return None, "rate_limited"
        if resp.status_code == 404:
            return None, "missing"
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json(), "ok"

    async def fetch_timeline(
        self, client: httpx.AsyncClient, match_id: str, *, retries: int = 2
    ) -> tuple[dict | None, str]:
        """Fetch match timeline for item purchase order. Same status codes as fetch_match."""
        url = f"{self.host}/lol/match/v5/matches/{match_id}/timeline"
        resp = await self._get(client, url, retries=retries)
        if resp.status_code == 429:
            return None, "rate_limited"
        if resp.status_code == 404:
            return None, "missing"
        _check_key_rejection(resp)
        resp.raise_for_status()
        return resp.json(), "ok"
