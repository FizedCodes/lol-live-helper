"""Post-game report: latest synced match graded vs role + lane opponent."""
from __future__ import annotations

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import JSONResponse

from app import config, postgame, riot, store

router = APIRouter(prefix="/api")


@router.get("/postgame")
async def postgame_report():
    """Detail the most recent synced SR game — grades, opponent, items, buy order."""
    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid")
        if not puuid:
            raise HTTPException(status_code=400, detail="Set your Riot ID first.")
        match_id = store.latest_match_id(conn, puuid)
        if not match_id:
            return {
                "ready": False,
                "note": "No synced matches yet. Hit Sync in Setup after a game.",
            }
    finally:
        conn.close()

    try:
        api = riot.RiotWebApi(config.region(), config.platform())
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    warning = None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            match, status = await api.fetch_match(client, match_id)
            if status == "rate_limited":
                raise HTTPException(
                    status_code=400,
                    detail="Riot rate-limited the post-game fetch. Wait ~2 minutes and open Stats again.",
                )
            if status == "missing" or match is None:
                raise HTTPException(status_code=400, detail="Latest match file was missing from Riot.")

            timeline, t_status = await api.fetch_timeline(client, match_id)
            if t_status != "ok":
                timeline = None
                warning = "Item buy order unavailable (timeline rate-limited or missing)."
    except HTTPException:
        raise
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Could not load post-game: {e}")

    conn = store.connect()
    try:
        # Need champ name from match for personal averages.
        info = match.get("info") or {}
        me = next(
            (p for p in info.get("participants", []) if p.get("puuid") == puuid),
            None,
        )
        champ = (me or {}).get("championName") or ""
        avgs = store.champ_metric_avgs(conn, puuid, champ) if champ else {"games": 0}
    finally:
        conn.close()

    report = postgame.build_report(match, puuid, timeline=timeline, champ_avgs=avgs)
    if warning:
        report["warning"] = warning
    return JSONResponse(content=report, headers={"Cache-Control": "no-store"})
