"""Thin backend endpoints for Riot API operations.

Feature tabs should keep using the higher-level routes (/api/live, /api/player,
/api/sync, /api/postgame). These endpoints expose the same server-side Riot
service primitives for debugging and for any UI that needs a single operation
without going through Riot from the browser.
"""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query

from app import riot_service

router = APIRouter(prefix="/api/riot")


@router.get("/key-status")
async def riot_key_status(force: bool = False):
    """Server env key presence + live validation (never returns the key)."""
    return await riot_service.key_status(force=force)


@router.get("/account")
async def riot_account(
    game_name: str = Query(..., min_length=1),
    tag_line: str = Query(..., min_length=1),
):
    """Account-V1: Riot ID → puuid + canonical name/tag."""
    try:
        return await riot_service.get_account(game_name.strip(), tag_line.strip().lstrip("#"))
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/summoner/{puuid}")
async def riot_summoner(puuid: str):
    """Summoner-V4 profile (level, icon) by puuid."""
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            return await riot_service.get_summoner_by_puuid(client, puuid)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/league/{puuid}")
async def riot_league(puuid: str):
    """League-V4 ranked entries by puuid."""
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            return await riot_service.get_league_entries(client, puuid)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/matches")
async def riot_match_ids(
    puuid: str = Query(..., min_length=10),
    count: int = Query(20, ge=1, le=100),
    start_time: int | None = Query(None, description="Unix seconds; only matches after this"),
):
    """Match-V5: newest-first match id list."""
    try:
        ids = await riot_service.get_match_ids(puuid, count, start_time=start_time)
        return {"puuid": puuid, "count": len(ids), "match_ids": ids}
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.get("/match/{match_id}")
async def riot_match(match_id: str):
    """Match-V5 full match payload."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            match, status = await riot_service.fetch_match(client, match_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if status == "rate_limited":
        raise HTTPException(status_code=429, detail="Riot rate-limited this match fetch. Wait and retry.")
    if status == "missing" or match is None:
        raise HTTPException(status_code=404, detail="Match not found at Riot.")
    return match


@router.get("/match/{match_id}/timeline")
async def riot_timeline(match_id: str):
    """Match-V5 timeline (item buy order, etc.)."""
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            timeline, status = await riot_service.fetch_timeline(client, match_id)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    if status == "rate_limited":
        raise HTTPException(status_code=429, detail="Riot rate-limited this timeline fetch. Wait and retry.")
    if status == "missing" or timeline is None:
        raise HTTPException(status_code=404, detail="Timeline not found at Riot.")
    return timeline
