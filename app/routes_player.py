"""One-click / searchable player lookup via Riot Account + League-V4 + recent matches."""
from __future__ import annotations

import time

import httpx
from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import JSONResponse

from app import config, ranks, riot

router = APIRouter(prefix="/api")

# Show enough games that a 10–20 games/day player still looks "today-heavy".
RECENT_MATCH_COUNT = 20

QUEUE_LABELS = {
    400: "Normal Draft",
    420: "Ranked Solo",
    430: "Normal Blind",
    440: "Ranked Flex",
    450: "ARAM",
    490: "Quickplay",
    700: "Clash",
    830: "Intro Bots",
    840: "Beginner Bots",
    850: "Intermediate Bots",
    890: "Intermediate Bots",
    900: "ARURF",
    1020: "One for All",
    1700: "Arena",
}

RANKED_QUEUE_IDS = {420, 440}
SR_QUEUE_IDS = {400, 420, 430, 440, 490}

# Rough ladder height for "high elo on a thin account" combos.
_TIER_HEIGHT = {
    "IRON": 0,
    "BRONZE": 1,
    "SILVER": 2,
    "GOLD": 3,
    "PLATINUM": 4,
    "EMERALD": 5,
    "DIAMOND": 6,
    "MASTER": 7,
    "GRANDMASTER": 8,
    "CHALLENGER": 9,
}


def _entry_summary(entry: dict | None, queue_label: str) -> dict | None:
    if not entry:
        return None
    wins = int(entry.get("wins") or 0)
    losses = int(entry.get("losses") or 0)
    games = wins + losses
    return {
        "queue": queue_label,
        "tier": entry.get("tier"),
        "division": entry.get("rank"),
        "lp": entry.get("leaguePoints", 0),
        "wins": wins,
        "losses": losses,
        "games": games,
        "win_rate": round(100.0 * wins / games, 1) if games else None,
    }


def _best_tier(solo: dict | None, flex: dict | None) -> tuple[str | None, int]:
    """Return (tier_name, height) for the higher of solo/flex."""
    best_tier, best_h = None, -1
    for entry in (solo, flex):
        if not entry or not entry.get("tier"):
            continue
        tier = str(entry["tier"]).upper()
        h = _TIER_HEIGHT.get(tier, -1)
        if h > best_h:
            best_tier, best_h = tier, h
    return best_tier, best_h


def _kda(m: dict) -> float:
    return (int(m.get("kills") or 0) + int(m.get("assists") or 0)) / max(1, int(m.get("deaths") or 0))


def _cs_per_min(m: dict) -> float | None:
    dur = int(m.get("duration") or 0)
    if dur < 300:
        return None
    return float(m.get("cs") or 0) / (dur / 60.0)


def _smurf_signal(
    level: int | None,
    ranked_games: int,
    recent: list[dict],
    solo: dict | None = None,
    flex: dict | None = None,
) -> dict:
    """Heuristic flags — not proof. Score weights so one soft flag alone rarely alarms."""
    flags: list[str] = []
    score = 0
    tier, tier_h = _best_tier(solo, flex)
    decided = [m for m in recent if m.get("win") is not None]
    ranked_recent = [m for m in decided if m.get("queue_id") in RANKED_QUEUE_IDS]
    sr_recent = [m for m in decided if m.get("queue_id") in SR_QUEUE_IDS]

    # --- Account freshness / ladder mismatch ---------------------------------
    if level is not None and level <= 40:
        flags.append(f"Summoner level {level} (low for a long-time account)")
        score += 2
    elif level is not None and level <= 55 and ranked_games < 80:
        flags.append(f"Level {level} with only {ranked_games} ranked games — still a young ladder account")
        score += 1

    if ranked_games == 0 and level is not None and level >= 30:
        flags.append("Level 30+ but no ranked games this season")
        score += 1
    elif ranked_games and ranked_games < 50:
        # Soft alone — strong when paired with high elo or low level.
        flags.append(f"Only {ranked_games} ranked games on record this season")
        score += 1

    if tier_h >= 5 and ranked_games < 60:  # Emerald+
        flags.append(
            f"{tier.title()} with only {ranked_games} ranked games — classic smurf / bought-boost ladder shape"
        )
        score += 3
    elif tier_h >= 6 and ranked_games < 100:  # Diamond+
        flags.append(f"{tier.title()} on a thin ranked sample ({ranked_games} games)")
        score += 2
    elif tier_h >= 4 and level is not None and level <= 45:  # Plat+ on low level
        flags.append(f"{tier.title()} at summoner level {level}")
        score += 3
    elif tier_h >= 3 and level is not None and level <= 35:  # Gold+ very fresh
        flags.append(f"{tier.title()} at summoner level {level}")
        score += 2

    # Season WR vs sample size (League entry wins/losses).
    for label, entry in (("Solo", solo), ("Flex", flex)):
        if not entry or not entry.get("games") or entry["games"] < 15:
            continue
        wr = entry.get("win_rate")
        if wr is not None and wr >= 65 and entry["games"] <= 60:
            flags.append(f"{wr:.0f}% {label} win rate over only {entry['games']} games")
            score += 2
        elif wr is not None and wr >= 70 and entry["games"] <= 100:
            flags.append(f"{wr:.0f}% {label} win rate over {entry['games']} games")
            score += 1

    # --- Recent activity patterns --------------------------------------------
    if len(decided) >= 5:
        wins = sum(1 for m in decided if m["win"])
        wr = 100.0 * wins / len(decided)
        if wr >= 75:
            flags.append(f"{wr:.0f}% win rate across last {len(decided)} games")
            score += 2
        elif wr >= 70:
            flags.append(f"{wr:.0f}% win rate across last {len(decided)} games")
            score += 1

    if len(ranked_recent) >= 6:
        rw = sum(1 for m in ranked_recent if m["win"])
        rwr = 100.0 * rw / len(ranked_recent)
        if rwr >= 75:
            flags.append(f"{rwr:.0f}% ranked win rate in last {len(ranked_recent)} ranked games")
            score += 2

    # Games-per-day over the span of the recent sample (smurf grind).
    stamps = sorted(int(m["played_at"]) for m in decided if m.get("played_at"))
    if len(stamps) >= 8:
        span_days = max((stamps[-1] - stamps[0]) / 86400.0, 0.5)
        gpd = len(stamps) / span_days
        if gpd >= 10:
            flags.append(f"Heavy grind — ~{gpd:.1f} games/day over the last {span_days:.1f} days")
            score += 2
        elif gpd >= 7:
            flags.append(f"High play volume — ~{gpd:.1f} games/day recently")
            score += 1

    # One-trick / tiny champ pool (smurfs often OTP).
    champs = [m.get("champion") for m in decided if m.get("champion")]
    if len(champs) >= 8:
        counts: dict[str, int] = {}
        for c in champs:
            counts[c] = counts.get(c, 0) + 1
        top_champ, top_n = max(counts.items(), key=lambda kv: kv[1])
        share = 100.0 * top_n / len(champs)
        unique = len(counts)
        if share >= 70:
            flags.append(f"OTP pattern — {top_champ} in {top_n}/{len(champs)} recent games ({share:.0f}%)")
            score += 2
        elif unique <= 3 and len(champs) >= 10:
            flags.append(f"Tiny champ pool — only {unique} champs in last {len(champs)} games")
            score += 1

    # Inflated KDA / CS (stomping below their real level).
    if len(decided) >= 8:
        avg_kda = sum(_kda(m) for m in decided) / len(decided)
        if avg_kda >= 5.5:
            flags.append(f"Inflated KDA — {avg_kda:.1f} average across last {len(decided)} games")
            score += 2
        elif avg_kda >= 4.5:
            flags.append(f"High KDA — {avg_kda:.1f} average across last {len(decided)} games")
            score += 1

    cs_samples = [_cs_per_min(m) for m in sr_recent]
    cs_samples = [x for x in cs_samples if x is not None]
    if len(cs_samples) >= 6:
        avg_cs = sum(cs_samples) / len(cs_samples)
        if avg_cs >= 8.5:
            flags.append(f"Very high CS pace — {avg_cs:.1f} CS/min in recent SR games")
            score += 1

    # Deduplicate flags while preserving order.
    seen: set[str] = set()
    uniq_flags = []
    for f in flags:
        if f not in seen:
            seen.add(f)
            uniq_flags.append(f)

    if score >= 4:
        severity = "flagged"
        likely = True
        label = "Possible smurf / new account"
        note = "Several soft signals line up — treat as a heads-up, not proof."
    elif score >= 2:
        severity = "watch"
        likely = True
        label = "Worth a glance"
        note = "A couple of smurf-ish patterns — maybe skilled, maybe a second account."
    else:
        severity = "ok"
        likely = False
        label = "Looks normal"
        note = "No strong smurf signals from level, ladder volume, or recent play patterns."

    return {
        "level": level,
        "ranked_games": ranked_games,
        "tier": tier,
        "score": score,
        "severity": severity,
        "likely_smurf": likely,
        "label": label,
        "note": note,
        "flags": uniq_flags,
    }


def _played_at(info: dict) -> int:
    """Epoch seconds for when the game actually started (fallback: lobby create time)."""
    ms = info.get("gameStartTimestamp") or info.get("gameCreation") or 0
    return int(ms // 1000)


async def _recent_matches(
    api: riot.RiotWebApi, client: httpx.AsyncClient, puuid: str, count: int = RECENT_MATCH_COUNT
) -> tuple[list[dict], str | None]:
    """Fetch newest matches with 429 retries. Returns (matches, warning_or_none)."""
    # Prefer the last ~14 days so the list can't silently drift to stale seasons.
    start_time = int(time.time()) - 14 * 86400
    try:
        ids = await api.get_match_ids(puuid, count, client, start_time=start_time)
    except RuntimeError as e:
        return [], str(e)
    except Exception as e:
        return [], f"Could not load match list: {e}"

    if not ids:
        # Fallback without startTime in case Riot's filter misbehaves for this account.
        try:
            ids = await api.get_match_ids(puuid, count, client)
        except Exception as e:
            return [], f"Could not load match list: {e}"

    out: list[dict] = []
    warning = None
    for match_id in ids:
        match, status = await api.fetch_match(client, match_id)
        if status == "rate_limited":
            warning = (
                "Riot rate-limited mid-lookup — showing partial history. "
                "Wait ~2 minutes and search again for the full list."
            )
            break
        if status == "missing" or match is None:
            continue
        info = match.get("info") or {}
        me = next((p for p in info.get("participants", []) if p.get("puuid") == puuid), None)
        if not me:
            continue
        queue_id = info.get("queueId")
        out.append({
            "match_id": match_id,
            "champion": me.get("championName"),
            "win": bool(me.get("win")),
            "kills": me.get("kills", 0),
            "deaths": me.get("deaths", 0),
            "assists": me.get("assists", 0),
            "cs": (me.get("totalMinionsKilled") or 0) + (me.get("neutralMinionsKilled") or 0),
            "damage": me.get("totalDamageDealtToChampions") or 0,
            "queue_id": queue_id,
            "queue": QUEUE_LABELS.get(queue_id, f"Queue {queue_id}"),
            "duration": info.get("gameDuration", 0),
            "played_at": _played_at(info),
        })

    out.sort(key=lambda m: m.get("played_at") or 0, reverse=True)
    return out, warning


@router.get("/player")
async def lookup_player(riot_id: str = Query(..., min_length=3)):
    """Look up a player's ranked stats, smurf signals, and recent matches."""
    if "#" not in riot_id:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")
    name, tag = riot_id.split("#", 1)
    name, tag = name.strip(), tag.strip()
    if not name or not tag:
        raise HTTPException(status_code=400, detail="Riot ID must look like Name#Tag.")

    # Practice-tool / custom bots aren't real accounts with useful history.
    if tag.upper() == "BOT" or name.lower().endswith(" bot"):
        raise HTTPException(
            status_code=400,
            detail="That looks like a co-op vs AI / practice bot, not a real player.",
        )

    try:
        api = riot.RiotWebApi(config.region(), config.platform())
        account = await api.get_account(name, tag)
    except RuntimeError as e:
        raise HTTPException(status_code=400, detail=str(e))

    canonical = f"{account['gameName']}#{account['tagLine']}"
    puuid = account["puuid"]

    level = None
    warning = None
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            try:
                summoner = await api.get_summoner_by_puuid(client, puuid)
                level = summoner.get("summonerLevel")
            except Exception:
                level = None
            try:
                entries = await api.get_league_entries(client, puuid)
            except Exception as e:
                raise HTTPException(status_code=400, detail=f"Could not fetch ranks: {e}")
            recent, warning = await _recent_matches(api, client, puuid, count=RECENT_MATCH_COUNT)
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    solo = next((e for e in entries if e.get("queueType") == "RANKED_SOLO_5x5"), None)
    flex = next((e for e in entries if e.get("queueType") == "RANKED_FLEX_SR"), None)
    summary_solo = _entry_summary(solo, "Solo")
    summary_flex = _entry_summary(flex, "Flex")

    if summary_solo:
        ranks.cache_rank(canonical, {
            "tier": summary_solo["tier"],
            "division": summary_solo["division"],
            "lp": summary_solo["lp"],
            "queue": "Solo",
        })
    elif flex:
        ranks.cache_rank(canonical, {
            "tier": flex["tier"],
            "division": flex["rank"],
            "lp": flex["leaguePoints"],
            "queue": "Flex",
        })
    else:
        ranks.cache_rank(canonical, {"tier": None})

    ranked_games = (summary_solo["games"] if summary_solo else 0) + (
        summary_flex["games"] if summary_flex else 0
    )

    payload = {
        "riot_id": canonical,
        "puuid": puuid,
        "solo": summary_solo,
        "flex": summary_flex,
        "summoner_level": level,
        "smurf": _smurf_signal(level, ranked_games, recent, summary_solo, summary_flex),
        "recent_matches": recent,
        "matches_warning": warning,
    }
    # Prevent browsers from serving a stale lookup from an earlier session.
    return JSONResponse(
        content=payload,
        headers={"Cache-Control": "no-store"},
    )
