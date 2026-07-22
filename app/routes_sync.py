"""Match history sync and aggregate stats endpoints."""
from __future__ import annotations

import asyncio

import httpx
from fastapi import APIRouter, HTTPException

from app import config, riot, store

router = APIRouter(prefix="/api")


@router.post("/sync")
async def sync_matches():
    """Pull recent Summoner's Rift matches and store personal matchup rows."""
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid")
        if not puuid:
            raise HTTPException(status_code=400, detail="Set your Riot ID first.")
        try:
            api = riot.RiotWebApi(config.region())
            match_ids = await api.get_match_ids(puuid, config.sync_match_count())
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))

        known = store.known_match_ids(conn)
        todo = [m for m in match_ids if m not in known]
        stored = 0
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for match_id in todo:
                    match = await api.get_match(client, match_id)
                    if match is None:  # rate limited: dev keys allow 100 req / 2 min
                        await asyncio.sleep(10)
                        match = await api.get_match(client, match_id)
                        if match is None:
                            break
                    if store.record_match(conn, match, puuid):
                        stored += 1
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"fetched": len(todo), "stored": stored, "total_known": len(known) + stored}
    finally:
        conn.close()


@router.get("/stats")
async def stats():
    conn = store.connect()
    try:
        return store.summary(conn)
    finally:
        conn.close()
