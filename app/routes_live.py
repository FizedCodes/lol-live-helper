"""The live game endpoint: joins the local game client data with your matchup history."""
from __future__ import annotations

import json
import time

from fastapi import APIRouter

from app import analysis, ranks, riot_service, store

router = APIRouter(prefix="/api")


def _scores_of(p: dict) -> dict:
    s = p.get("scores") or {}
    out = {
        "kills": s.get("kills", 0),
        "deaths": s.get("deaths", 0),
        "assists": s.get("assists", 0),
        "cs": s.get("creepScore", 0),
    }
    # Live Client wardScore — useful for overlay vision pace (you + others).
    ward = s.get("wardScore")
    if isinstance(ward, (int, float)):
        out["ward_score"] = float(ward)
    return out


def _objectives_of(game: dict) -> dict:
    """Count Live Client eventdata into a compact overlay-friendly summary."""
    events = (game.get("events") or {}).get("Events") or []
    counts = {
        "dragon": 0,
        "baron": 0,
        "herald": 0,
        "tower": 0,
        "inhibitor": 0,
        "horde": 0,
    }
    name_map = {
        "DragonKill": "dragon",
        "BaronKill": "baron",
        "HeraldKill": "herald",
        "TowerKill": "tower",
        "InhibKill": "inhibitor",
        "InhibitorKill": "inhibitor",
        "HordeKill": "horde",
    }
    for e in events:
        key = name_map.get(e.get("EventName") or "")
        if key:
            counts[key] += 1
    return counts


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


def _rune_bits(obj: dict | None) -> dict | None:
    if not obj:
        return None
    return {
        "id": obj.get("id"),
        "name": obj.get("displayName") or obj.get("rawDisplayName") or "",
    }


def _live_stats_of(active: dict) -> dict | None:
    """Combat totals from activePlayer.championStats (you only — enemies lack this)."""
    raw = active.get("championStats") or {}
    if not isinstance(raw, dict) or not raw:
        return None
    # Keep the fields the fight/hover UI actually shows (plus a few extras for later).
    keys = (
        "abilityHaste",
        "abilityPower",
        "armor",
        "attackDamage",
        "attackSpeed",
        "critChance",
        "currentHealth",
        "maxHealth",
        "magicResist",
        "moveSpeed",
        "lifeSteal",
        "physicalLethality",
        "armorPenetrationFlat",
        "magicPenetrationFlat",
        "magicPenetrationPercent",
        "tenacity",
    )
    out = {}
    for k in keys:
        v = raw.get(k)
        if isinstance(v, (int, float)):
            out[k] = float(v)
    if active.get("level") is not None:
        try:
            out["level"] = int(active["level"])
        except (TypeError, ValueError):
            pass
    gold = active.get("currentGold")
    if isinstance(gold, (int, float)):
        out["current_gold"] = float(gold)
    return out or None


def _runes_of(p: dict, *, full: dict | None = None) -> dict | None:
    """Normalize live-client rune payloads into a small frontend-friendly shape.

    allPlayers usually only has keystone + trees. activePlayer.fullRunes also
    includes the full perk row and stat shards when available.
    """
    src = full or p.get("runes") or {}
    if not src:
        return None
    keystone = _rune_bits(src.get("keystone"))
    primary = _rune_bits(src.get("primaryRuneTree"))
    secondary = _rune_bits(src.get("secondaryRuneTree"))
    perks = [_rune_bits(r) for r in (src.get("generalRunes") or []) if r]
    shards = []
    for r in src.get("statRunes") or []:
        if not r:
            continue
        # Stat shards often lack displayName — keep id for icon lookup.
        shards.append({
            "id": r.get("id"),
            "name": r.get("displayName") or r.get("rawDescription") or f"Shard {r.get('id')}",
        })
    if not any([keystone, primary, secondary, perks, shards]):
        return None
    return {
        "keystone": keystone,
        "primary": primary,
        "secondary": secondary,
        "perks": [x for x in perks if x],
        "shards": shards,
    }


def _read_last_game() -> dict | None:
    """Last-game snapshot from SQLite. Never raises — live view must stay up."""
    try:
        conn = store.connect()
        try:
            puuid = store.get_meta(conn, "puuid")
            last = store.get_meta(conn, f"last_game:{puuid}") if puuid else None
        finally:
            conn.close()
        return json.loads(last) if last else None
    except Exception:
        return None


@router.get("/live")
async def live(lite: bool = False):
    """Live Client snapshot.

    ``lite=1`` is the in-game detector (Electron poll): Live Client only, no
    SQLite and no Riot. Full payload (matchups / ranks) is for the dashboard
    and overlay HUD. Ranks still skip when no API key is loaded.
    """
    game = await riot_service.fetch_live_game()
    if lite:
        return {"in_game": game is not None}

    if game is None:
        return {"in_game": False, "last_game": _read_last_game()}

    players = game.get("allPlayers", [])
    active = game.get("activePlayer") or {}
    active_name = active.get("riotId") or active.get("summonerName", "")
    me = next((p for p in players if p.get("riotId") == active_name or p.get("summonerName") == active_name), None)
    if me is None:
        return {"in_game": True, "error": "Could not identify the active player in this game."}

    my_champ = me.get("championName", "")
    my_team = me.get("team")
    my_pos = (me.get("position") or "").upper()
    my_full_runes = (active.get("fullRunes") or None)
    my_live_stats = _live_stats_of(active)

    try:
        conn = store.connect()
    except Exception:
        return {
            "in_game": True,
            "error": "Live Client is up, but the local database failed to open.",
        }
    try:
        puuid = store.get_meta(conn, "puuid") or ""
        my_overall = store.champ_overall(conn, puuid, my_champ)
        ranked_wr = store.queue_win_rate(conn, puuid, store.RANKED_QUEUES)
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
                "runes": _runes_of(p, full=my_full_runes if p is me else None),
                "is_dead": bool(p.get("isDead")),
                "is_me": p is me,
            }
            # Live client only exposes full championStats for the active player.
            if p is me and my_live_stats:
                entry["live_stats"] = my_live_stats
                if "level" in my_live_stats:
                    entry["level"] = my_live_stats["level"]
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

        try:
            player_ranks = await ranks.fetch_ranks([p["riot_id"] for p in enemies + allies])
        except Exception:
            player_ranks = {}
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
            "me": {
                "champion": my_champ,
                "position": my_pos,
                "overall": my_overall,       # WR on this champion (all queues)
                "ranked": ranked_wr,         # personal ranked solo+flex WR
                "scores": _scores_of(me),
                "live_stats": my_live_stats,
                "level": (my_live_stats or {}).get("level"),
            },
            "team_kills": team_kills,
            "objectives": _objectives_of(game),
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
