"""Settings endpoints: Riot ID + session/env key status (raw key never returned)."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import config, riot, riot_service, store

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
        key = config.set_session_api_key(body.api_key)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    try:
        valid = await riot.validate_key(key, config.platform())
    except Exception as e:
        raise HTTPException(
            status_code=400,
            detail=f"Key stored for this session, but Riot could not be reached: {e}",
        )
    if valid is False:
        config.clear_session_api_key()
        raise HTTPException(
            status_code=400,
            detail="Riot rejected that key (expired?). Get a fresh one at developer.riotgames.com.",
        )
    return {
        "ok": True,
        "valid": valid,
        "source": "session",
        "persisted": False,
    }


@router.delete("/key")
async def clear_key():
    """Clear the in-memory session key. Env RIOT_API_KEY (if set) still applies."""
    config.clear_session_api_key()
    return {
        "ok": True,
        "has_api_key": riot_service.has_api_key(),
        "key_source": config.key_source(),
    }


@router.get("/key/status")
async def key_status():
    """Same payload as /api/riot/key-status (kept for existing UI)."""
    return await riot_service.key_status()
