"""Settings endpoints: Riot ID + session/env key status (raw key never returned)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import config, ranks, riot, riot_service, store

router = APIRouter(prefix="/api")


class ConfigIn(BaseModel):
    game_name: str
    tag_line: str


class KeyIn(BaseModel):
    api_key: str


@router.get("/config")
async def get_config():
    conn = store.connect()
    try:
        return {
            "game_name": store.get_meta(conn, "game_name"),
            "tag_line": store.get_meta(conn, "tag_line"),
            "region": config.region(),
            "platform": config.platform(),
            "has_api_key": riot_service.has_api_key(),
            "key_source": config.key_source(),
        }
    finally:
        conn.close()


@router.post("/config")
async def set_config(cfg: ConfigIn):
    try:
        account = await riot_service.get_account(
            cfg.game_name.strip(), cfg.tag_line.strip().lstrip("#")
        )
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    # Store the canonical casing Riot returns, not what was typed
    game_name = account.get("gameName") or cfg.game_name.strip()
    tag_line = account.get("tagLine") or cfg.tag_line.strip().lstrip("#")
    conn = store.connect()
    try:
        store.set_meta(conn, "game_name", game_name)
        store.set_meta(conn, "tag_line", tag_line)
        store.set_meta(conn, "puuid", account["puuid"])
    finally:
        conn.close()
    return {"ok": True, "game_name": game_name, "tag_line": tag_line}


@router.post("/key")
async def set_key(body: KeyIn):
    """Hold a key in server memory for this process only — never SQLite / .env."""
    try:
        # Normalize + shape-check first; only store after shape looks real.
        key = config.normalize_api_key(body.api_key)
        if not key.startswith("RGAPI-") or key.startswith("RGAPI-your") or key == "RGAPI-":
            raise RuntimeError("Paste a real Riot API key (starts with RGAPI-).")
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    valid, warning = await riot.validate_key(key, config.platform())
    if valid is False:
        raise HTTPException(
            status_code=400,
            detail=(
                "Riot rejected that key (expired or invalid). "
                "Regenerate at developer.riotgames.com and paste the new one."
            ),
        )

    # Accept on True OR None (rate-limited / unreachable). Spamming Setup used to
    # fail with 400 whenever live polls had already burned the 100/2min quota.
    config.set_session_api_key(key)
    ranks.clear_cache()
    riot_service.seed_key_status_cache(valid=valid, source="session", warning=warning)

    return {
        "ok": True,
        "valid": valid,
        "source": "session",
        "persisted": False,
        "warning": warning,
    }


@router.delete("/key")
async def clear_key():
    """Clear the in-memory session key. Env RIOT_API_KEY (if set) still applies."""
    config.clear_session_api_key()
    ranks.clear_cache()
    riot_service.clear_key_status_cache()
    return {
        "ok": True,
        "has_api_key": riot_service.has_api_key(),
        "key_source": config.key_source(),
    }


@router.get("/key/status")
async def key_status(force: bool = False):
    """Same payload as /api/riot/key-status (kept for existing UI)."""
    return await riot_service.key_status(force=force)
