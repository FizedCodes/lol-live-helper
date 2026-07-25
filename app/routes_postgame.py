"""Post-game report: history list + per-match grades / opponent / items."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app import postgame, riot_service, store

router = APIRouter(prefix="/api")


@router.get("/postgame/list")
async def postgame_list(limit: int = Query(40, ge=1, le=100)):
    """Synced match history for the Postgame tab — SQLite only, no Riot calls."""
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid")
        if not puuid:
            raise HTTPException(status_code=400, detail="Set your Riot ID first.")
        games = store.recent_match_list(conn, puuid, limit=limit)
        return JSONResponse(
            content={"ready": True, "games": games, "count": len(games)},
            headers={"Cache-Control": "no-store"},
        )
    finally:
        conn.close()


@router.get("/postgame")
async def postgame_report(
    match_id: str | None = Query(None, description="Synced match id; default = latest"),
    refresh: bool = Query(False, description="Rebuild even if a saved report exists"),
):
    """Detail one synced SR game — grades, opponent, items, buy order.

    Prefers saved report → match/timeline SQLite caches → Riot (then saves).
    """
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid")
        if not puuid:
            raise HTTPException(status_code=400, detail="Set your Riot ID first.")

        mid = match_id or store.latest_match_id(conn, puuid)
        if not mid:
            return {
                "ready": False,
                "note": "No synced matches yet. Hit Sync in Setup after a game.",
            }
        if not store.owns_match(conn, puuid, mid):
            raise HTTPException(status_code=400, detail="That match is not in your synced history.")

        if not refresh:
            cached = store.get_postgame_report(conn, puuid, mid)
            if cached and cached.get("ready"):
                cached["from_cache"] = True
                return JSONResponse(content=cached, headers={"Cache-Control": "no-store"})

        match = store.get_match_payload(conn, mid)
        timeline = store.get_timeline_payload(conn, mid)
    finally:
        conn.close()

    warning = None
    need_match = match is None
    need_timeline = timeline is None

    if need_match or need_timeline:
        try:
            if not riot_service.has_api_key():
                raise RuntimeError(
                    "No Riot API key configured. Paste one in Setup for this session, "
                    "or set RIOT_API_KEY in .env and restart."
                )
            api = riot_service.web_api()
        except Exception as e:
            raise HTTPException(status_code=400, detail=str(e))

        try:
            async with httpx.AsyncClient(timeout=20.0) as client:
                if need_match:
                    match, status = await api.fetch_match(client, mid)
                    if status == "rate_limited":
                        raise HTTPException(
                            status_code=400,
                            detail="Riot rate-limited the post-game fetch. Wait ~2 minutes and try again.",
                        )
                    if status == "missing" or match is None:
                        raise HTTPException(
                            status_code=400,
                            detail="Match file was missing from Riot.",
                        )
                    conn = store.connect()
                    try:
                        store.put_match_payload(conn, mid, match)
                    finally:
                        conn.close()

                if need_timeline:
                    timeline, t_status = await api.fetch_timeline(client, mid)
                    if t_status == "ok" and timeline is not None:
                        conn = store.connect()
                        try:
                            store.put_timeline_payload(conn, mid, timeline)
                        finally:
                            conn.close()
                    else:
                        timeline = None
                        warning = "Item buy order unavailable (timeline rate-limited or missing)."
        except HTTPException:
            raise
        except RuntimeError as e:
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            raise HTTPException(status_code=400, detail=f"Could not load post-game: {e}")

    if match is None:
        raise HTTPException(status_code=400, detail="Could not load that match.")

    conn = store.connect()
    try:
        info = match.get("info") or {}
        me = next(
            (p for p in info.get("participants", []) if p.get("puuid") == puuid),
            None,
        )
        champ = (me or {}).get("championName") or ""
        avgs = store.champ_metric_avgs(conn, puuid, champ) if champ else {"games": 0}
        report = postgame.build_report(match, puuid, timeline=timeline, champ_avgs=avgs)
        if warning:
            report["warning"] = warning
        report["from_cache"] = False
        store.put_postgame_report(conn, puuid, mid, report)
    finally:
        conn.close()

    return JSONResponse(content=report, headers={"Cache-Control": "no-store"})
