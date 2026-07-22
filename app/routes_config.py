"""Settings endpoints: Riot ID and API key management."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from app import config, riot, store

router = APIRouter(prefix="/api")


class ConfigIn(BaseModel):
    game_name: str
    tag_line: str


class KeyIn(BaseModel):
    key: str


@router.get("/config")
async def get_config():
    conn = store.connect()
    try:
        return {
            "game_name": store.get_meta(conn, "game_name"),
            "tag_line": store.get_meta(conn, "tag_line"),
            "region": config.region(),
            "platform": config.platform(),
            "has_api_key": config.current_api_key() is not None,
            "key_source": config.key_source(),
        }
    finally:
        conn.close()


@router.post("/config")
async def set_config(cfg: ConfigIn):
    try:
        api = riot.RiotWebApi(config.region())
        account = await api.get_account(cfg.game_name.strip(), cfg.tag_line.strip().lstrip("#"))
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
    key = body.key.strip()
    if not key.startswith("RGAPI-"):
        raise HTTPException(status_code=400, detail="That doesn't look like a Riot API key (should start with RGAPI-).")
    try:
        valid = await riot.validate_key(key, config.platform())
    except Exception:
        raise HTTPException(status_code=502, detail="Could not reach Riot to validate the key. Try again.")
    if not valid:
        raise HTTPException(status_code=400, detail="Riot rejected that key — it may be expired or mistyped.")
    config.save_api_key(key)
    return {"ok": True}


@router.get("/key/status")
async def key_status():
    key = config.current_api_key()
    if not key:
        return {"configured": False, "valid": None, "source": None}
    try:
        valid = await riot.validate_key(key, config.platform())
    except Exception:
        valid = None  # couldn't reach Riot; unknown
    return {"configured": True, "valid": valid, "source": config.key_source()}
