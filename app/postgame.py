"""Build a post-game report from a Match-V5 payload (+ optional timeline)."""
from __future__ import annotations

from app import store

QUEUE_LABELS = {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    490: "Quickplay",
}

# Consumables / junk we skip in the buy-order strip.
_SKIP_ITEM_IDS = {
    2003, 2010, 2031, 2033, 2052, 2055, 2138, 2139, 2140,
    3340, 3363, 3364, 3513,  # trinkets often swap a lot
}


def _riot_id(p: dict) -> str:
    name = p.get("riotIdGameName") or p.get("summonerName") or ""
    tag = p.get("riotIdTagline") or ""
    if name and tag:
        return f"{name}#{tag}"
    return name or "Unknown"


def _items_of(p: dict) -> list[dict]:
    out = []
    for slot in range(7):
        iid = p.get(f"item{slot}") or 0
        if iid:
            out.append({"id": iid, "slot": slot})
    return out


def _team_totals(participants: list[dict], team_id) -> tuple[int, int]:
    kills = damage = 0
    for p in participants:
        if p.get("teamId") != team_id:
            continue
        kills += int(p.get("kills") or 0)
        damage += int(p.get("totalDamageDealtToChampions") or 0)
    return kills, damage


def _participant_stats(p: dict, participants: list[dict], duration_s: int) -> dict:
    mins = max(duration_s / 60.0, 1.0)
    cs = int(p.get("totalMinionsKilled") or 0) + int(p.get("neutralMinionsKilled") or 0)
    kills = int(p.get("kills") or 0)
    deaths = int(p.get("deaths") or 0)
    assists = int(p.get("assists") or 0)
    vision = int(p.get("visionScore") or 0)
    damage = int(p.get("totalDamageDealtToChampions") or 0)
    team_kills, team_damage = _team_totals(participants, p.get("teamId"))
    challenges = p.get("challenges") or {}
    kp_raw = challenges.get("killParticipation")
    if kp_raw is None:
        kp_raw = ((kills + assists) / team_kills) if team_kills else 0.0
    kp_raw = float(kp_raw)
    # Riot usually sends 0–1; treat anything above 1.5 as already a percent.
    kp_pct = round(kp_raw, 1) if kp_raw > 1.5 else round(kp_raw * 100, 1)
    dmg_share = (damage / team_damage) if team_damage else 0.0
    kda = (kills + assists) / max(1, deaths)
    pos = (p.get("teamPosition") or "UNKNOWN").upper()
    base = store.role_baseline(pos)

    cs_pm = round(cs / mins, 2)
    vis_pm = round(vision / mins, 2)

    grades = {
        "cs_per_min": {
            "label": "CS / min",
            "value": cs_pm,
            "baseline": base["cs_per_min"],
            "grade": store.grade_value(cs_pm, base["cs_per_min"]),
            "unit": "/m",
        },
        "vision_per_min": {
            "label": "Vision / min",
            "value": vis_pm,
            "baseline": base["vision_per_min"],
            "grade": store.grade_value(vis_pm, base["vision_per_min"]),
            "unit": "/m",
        },
        "kill_participation": {
            "label": "Kill participation",
            "value": kp_pct,
            "baseline": round(base["kp"] * 100, 1),
            "grade": store.grade_value(kp_pct, base["kp"] * 100),
            "unit": "%",
        },
        "damage_share": {
            "label": "Damage share",
            "value": round(dmg_share * 100, 1),
            "baseline": round(base["dmg_share"] * 100, 1),
            "grade": store.grade_value(dmg_share * 100, base["dmg_share"] * 100),
            "unit": "%",
        },
        "kda": {
            "label": "KDA",
            "value": round(kda, 2),
            "baseline": base["kda"],
            "grade": store.grade_value(kda, base["kda"]),
            "unit": "",
        },
    }

    return {
        "champion": p.get("championName"),
        "riot_id": _riot_id(p),
        "position": pos,
        "win": bool(p.get("win")),
        "kills": kills,
        "deaths": deaths,
        "assists": assists,
        "cs": cs,
        "cs_per_min": cs_pm,
        "vision_score": vision,
        "vision_per_min": vis_pm,
        "kill_participation": kp_pct,
        "damage": damage,
        "damage_share": round(dmg_share * 100, 1),
        "kda": round(kda, 2),
        "gold": int(p.get("goldEarned") or 0),
        "turret_kills": int(p.get("turretKills") or 0),
        "turret_takedowns": int(p.get("turretTakedowns") or challenges.get("turretTakedowns") or 0),
        "inhibitor_kills": int(p.get("inhibitorKills") or 0),
        "dragon_kills": int(p.get("dragonKills") or 0),
        "baron_kills": int(p.get("baronKills") or 0),
        "wards_placed": int(p.get("wardsPlaced") or 0),
        "wards_killed": int(p.get("wardsKilled") or 0),
        "items": _items_of(p),
        "grades": grades,
        "participant_id": p.get("participantId"),
    }


def _build_order(timeline: dict | None, participant_id: int | None) -> list[dict]:
    if not timeline or participant_id is None:
        return []
    buys: list[dict] = []
    for frame in (timeline.get("info") or {}).get("frames") or []:
        for ev in frame.get("events") or []:
            if ev.get("type") != "ITEM_PURCHASED":
                continue
            if ev.get("participantId") != participant_id:
                continue
            iid = int(ev.get("itemId") or 0)
            if not iid or iid in _SKIP_ITEM_IDS:
                continue
            buys.append({"id": iid, "time_s": int(ev.get("timestamp") or 0) // 1000})
    # Keep the strip readable — last stretch of the game matters most for completed items,
    # but early components teach the path; cap length.
    if len(buys) > 18:
        buys = buys[:6] + buys[-12:]
    return buys


def _compare_rows(me: dict, foe: dict | None) -> list[dict]:
    keys = [
        ("cs_per_min", "CS / min", False),
        ("vision_score", "Vision", False),
        ("kill_participation", "KP %", False),
        ("damage_share", "Dmg %", False),
        ("kda", "KDA", False),
        ("gold", "Gold", False),
        ("turret_takedowns", "Turret takedowns", False),
    ]
    rows = []
    for key, label, _ in keys:
        mv = me.get(key)
        fv = foe.get(key) if foe else None
        winner = "tie"
        if foe is not None and mv is not None and fv is not None:
            if mv > fv:
                winner = "me"
            elif fv > mv:
                winner = "foe"
        rows.append({"key": key, "label": label, "me": mv, "foe": fv, "winner": winner})
    return rows


def build_report(
    match: dict,
    puuid: str,
    *,
    timeline: dict | None = None,
    champ_avgs: dict | None = None,
) -> dict:
    info = match.get("info") or {}
    participants = info.get("participants") or []
    me_raw = next((p for p in participants if p.get("puuid") == puuid), None)
    if not me_raw:
        return {"ready": False, "error": "You were not found in this match file."}

    duration_s = int(info.get("gameDuration") or 0)
    me = _participant_stats(me_raw, participants, duration_s)
    me["build_order"] = _build_order(timeline, me_raw.get("participantId"))

    my_pos = me["position"]
    foe_raw = next(
        (
            p for p in participants
            if p.get("teamId") != me_raw.get("teamId")
            and (p.get("teamPosition") or "").upper() == my_pos
            and my_pos != "UNKNOWN"
        ),
        None,
    )
    if foe_raw is None:
        # Fallback: highest damage enemy if no clear laner.
        enemies = [p for p in participants if p.get("teamId") != me_raw.get("teamId")]
        foe_raw = max(
            enemies,
            key=lambda p: int(p.get("totalDamageDealtToChampions") or 0),
            default=None,
        )

    foe = None
    if foe_raw:
        foe = _participant_stats(foe_raw, participants, duration_s)
        foe["build_order"] = _build_order(timeline, foe_raw.get("participantId"))
        foe["is_lane_opponent"] = (
            (foe_raw.get("teamPosition") or "").upper() == my_pos and my_pos != "UNKNOWN"
        )

    focus = [
        {"key": k, **g}
        for k, g in me["grades"].items()
        if g["grade"] == "weak"
    ]

    # Grade this game vs your personal champ average when we have history.
    vs_you = []
    avgs = champ_avgs or {}
    if avgs.get("games", 0) >= 3:
        for key, label in (
            ("cs_per_min", "CS / min"),
            ("vision_per_min", "Vision / min"),
            ("kill_participation", "KP %"),
            ("damage_share", "Dmg %"),
            ("kda", "KDA"),
        ):
            avg = avgs.get(key)
            val = me.get(key)
            if avg is None or val is None:
                continue
            delta = round(val - avg, 2)
            vs_you.append({
                "key": key,
                "label": label,
                "value": val,
                "avg": avg,
                "delta": delta,
                "grade": "strong" if delta > 0 else ("weak" if delta < 0 else "ok"),
            })

    queue_id = info.get("queueId")
    played_at = int((info.get("gameCreation") or 0) // 1000)
    return {
        "ready": True,
        "match_id": (match.get("metadata") or {}).get("matchId"),
        "queue_id": queue_id,
        "queue": QUEUE_LABELS.get(queue_id, f"Queue {queue_id}"),
        "duration": duration_s,
        "played_at": played_at,
        "result": "Win" if me["win"] else "Loss",
        "me": me,
        "opponent": foe,
        "compare": _compare_rows(me, foe),
        "focus": focus,
        "vs_champ_avg": vs_you,
        "champ_avg_games": avgs.get("games", 0),
        "timeline_ready": bool(timeline),
    }
