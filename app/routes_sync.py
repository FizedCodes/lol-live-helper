"""Match history sync and aggregate stats endpoints."""
from __future__ import annotations

import asyncio
import json

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import StreamingResponse

from app import config, riot_service, store
from app.riot import RiotWebApi

router = APIRouter(prefix="/api")


def _ndjson(obj: dict) -> str:
    return json.dumps(obj, separators=(",", ":")) + "\n"


async def _get_match_cached(api: RiotWebApi, client: httpx.AsyncClient, conn, match_id: str):
    """SQLite match_cache first; Riot only on miss. Returns None if rate-limited."""
    hit = store.get_match_payload(conn, match_id)
    if hit is not None:
        return hit
    match = await api.get_match(client, match_id)
    if match is None:
        return None
    store.put_match_payload(conn, match_id, match)
    return match


@router.post("/sync")
async def sync_matches(
    stream: bool = Query(False, description="NDJSON progress while matches sync"),
):
    """Pull recent Summoner's Rift matches and store personal matchup rows."""
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid")
        if not puuid:
            raise HTTPException(status_code=400, detail="Set your Riot ID first.")
        try:
            api = riot_service.web_api(platform=False)
            match_ids = await api.get_match_ids(puuid, config.sync_match_count())
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))

        known = store.known_match_ids(conn, puuid)
        todo = [m for m in match_ids if m not in known]

        if stream:
            # Keep conn open across the generator — closed when stream finishes.
            return StreamingResponse(
                _sync_stream(conn, api, puuid, known, todo),
                media_type="application/x-ndjson",
                headers={"Cache-Control": "no-store"},
            )

        stored = 0
        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                for match_id in todo:
                    match = await _get_match_cached(api, client, conn, match_id)
                    if match is None:  # rate limited: dev keys allow 100 req / 2 min
                        await asyncio.sleep(10)
                        match = await _get_match_cached(api, client, conn, match_id)
                        if match is None:
                            break
                    if store.record_match(conn, match, puuid):
                        stored += 1
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        return {"fetched": len(todo), "stored": stored, "total_known": len(known) + stored}
    finally:
        # Streaming path owns/closes the connection inside the generator.
        if not stream:
            conn.close()


async def _sync_stream(conn, api: RiotWebApi, puuid: str, known: set, todo: list[str]):
    stored = 0
    total = len(todo)
    try:
        yield _ndjson({
            "type": "meta",
            "todo": total,
            "total_known": len(known),
        })
        yield _ndjson({"type": "progress", "done": 0, "total": total, "stored": 0})
        async with httpx.AsyncClient(timeout=10.0) as client:
            for i, match_id in enumerate(todo, start=1):
                match = await _get_match_cached(api, client, conn, match_id)
                if match is None:
                    await asyncio.sleep(10)
                    match = await _get_match_cached(api, client, conn, match_id)
                    if match is None:
                        yield _ndjson({
                            "type": "done",
                            "fetched": i - 1,
                            "stored": stored,
                            "total_known": len(known) + stored,
                            "partial": True,
                            "detail": "Riot rate-limited mid-sync — wait ~2 minutes and Sync again.",
                        })
                        return
                if store.record_match(conn, match, puuid):
                    stored += 1
                yield _ndjson({
                    "type": "progress",
                    "done": i,
                    "total": total,
                    "stored": stored,
                })
        yield _ndjson({
            "type": "done",
            "fetched": total,
            "stored": stored,
            "total_known": len(known) + stored,
            "partial": False,
        })
    except Exception as e:
        yield _ndjson({"type": "error", "detail": str(e)})
    finally:
        conn.close()


@router.get("/stats")
async def stats():
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid") or ""
        return store.summary(conn, puuid)
    finally:
        conn.close()
