"""The live game endpoint: joins the local game client data with your matchup history."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter

from app import analysis, ranks, riot, store

router = APIRouter(prefix="/api")


def _scores_of(p: dict) -> dict:
    s = p.get("scores") or {}
    return {
        "kills": s.get("kills", 0),
        "deaths": s.get("deaths", 0),
        "assists": s.get("assists", 0),
        "cs": s.get("creepScore", 0),
    }


def _items_of(p: dict) -> list[dict]:
    return [
        {
            "id": it.get("itemID"),
            "name": it.get("displayName", ""),
            "slot": it.get("slot", 0),
            "count": it.get("count", 1),
        }
        for it in (p.get("items") or [])
    ]


@router.get("/live")
async def live():
    game = await riot.fetch_live_game()
    if game is None:
        conn = store.connect()
        try:
            puuid = store.get_meta(conn, "puuid")
            last = store.get_meta(conn, f"last_game:{puuid}") if puuid else None
            return {"in_game": False, "last_game": json.loads(last) if last else None}
        finally:
            conn.close()

    players = game.get("allPlayers", [])
    active = game.get("activePlayer") or {}
    active_name = active.get("riotId") or active.get("summonerName", "")
    me = next((p for p in players if p.get("riotId") == active_name or p.get("summonerName") == active_name), None)
    if me is None:
        return {"in_game": True, "error": "Could not identify the active player in this game."}

    my_champ = me.get("championName", "")
    my_team = me.get("team")
    my_pos = (me.get("position") or "").upper()

    conn = store.connect()
    try:
        puuid = store.get_meta(conn, "puuid") or ""
        my_overall = store.champ_overall(conn, puuid, my_champ)
        enemies, allies = [], []
        team_kills = {"ally": 0, "enemy": 0}
        for p in players:
            champ = p.get("championName", "")
            entry = {
                "champion": champ,
                "riot_id": p.get("riotId") or p.get("summonerName"),
                "position": (p.get("position") or "").upper(),
                "scores": _scores_of(p),
                "items": _items_of(p),
                "is_dead": bool(p.get("isDead")),
                "is_me": p is me,
            }
            if p.get("team") == my_team:
                team_kills["ally"] += entry["scores"]["kills"]
                allies.append(entry)
            else:
                team_kills["enemy"] += entry["scores"]["kills"]
                m = store.matchup_stats(conn, puuid, my_champ, champ)
                entry["is_lane_opponent"] = bool(my_pos) and entry["position"] == my_pos
                entry["stats"] = m
                entry["verdict"] = analysis.verdict(m, my_overall)
                enemies.append(entry)
        # Put the direct lane opponent first, and yourself first on your team
        enemies.sort(key=lambda e: not e["is_lane_opponent"])
        allies.sort(key=lambda a: not a["is_me"])

        player_ranks = await ranks.fetch_ranks([p["riot_id"] for p in enemies + allies])
        for p in enemies + allies:
            p["rank"] = player_ranks.get(p["riot_id"])

        # The client reports GameEnd (with Win/Lose) for a short while after the nexus falls
        result = next(
            (
                e.get("Result")
                for e in (game.get("events") or {}).get("Events", [])
                if e.get("EventName") == "GameEnd"
            ),
            None,
        )

        payload = {
            "in_game": True,
            "game_time": (game.get("gameData") or {}).get("gameTime", 0),
            "me": {"champion": my_champ, "position": my_pos, "overall": my_overall, "scores": _scores_of(me)},
            "team_kills": team_kills,
            "enemies": enemies,
            "allies": allies,
            "result": result,
        }
        # Snapshot every poll so the dashboard can replay the last game once you leave
        if puuid:
            store.set_meta(conn, f"last_game:{puuid}", json.dumps({"saved_at": time.time(), "data": payload}))
        return payload
    finally:
        conn.close()
