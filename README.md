# LoL Live Helper

**Version:** 0.8.0 (see `VERSION`)

A local dashboard that shows your matchup context **while you're in a League of Legends game**: for every enemy champion it shows your personal win rate against them (overall, as a lane opponent, and on your current champion), and gives a simple call — **Push hard**, **Even**, or **Play safe**.

## How it works

- **Live game detection** uses Riot's [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api), which the League client serves locally at `https://127.0.0.1:2999` while you're in a game. No API key needed for this part.
- **Matchup stats** are built from *your own* ranked history via Riot's Match-V5 API. This needs a (free) API key. Riot doesn't publish global matchup win rates through the API, so the numbers here are personal — which is arguably more useful: they reflect how *you* actually do into each champion.

## Code layout

```
app/                    Python backend (FastAPI)
  main.py               wiring only: creates the app, mounts routes + static files
  routes_config.py      /api/config + session/env key endpoints (Riot ID; raw key never returned)
  routes_riot.py        /api/riot/* thin wrappers (account, league, match, …)
  routes_sync.py        /api/sync + /api/stats (match history)
  routes_live.py        /api/live (the in-game view)
  analysis.py           play safe / push hard verdict rules (tune thresholds here)
  ranks.py              League-V4 rank lookups, cached per server run
  riot.py               low-level HTTP clients for Riot's APIs
  riot_service.py       centralized server-side Riot entry point
  store.py              SQLite persistence and matchup aggregation
  config.py             settings (session key in RAM + optional RIOT_API_KEY)
static/                 Frontend (plain HTML/CSS/JS, no build step)
  index.html            page skeleton: tabs (Live / Builds / Stats / Setup)
  js/main.js            entry point: tab router, event wiring, 10s polling loop
  js/render.js          pure HTML-building functions (live, fight compare, stats, player card)
  js/items.js           Data Dragon catalogs, icon URLs, item stats, build-path tooltips
  js/builds.js          META core, build order, situational alternatives
  js/hover.js           champion hover panel (tip slider + item-powered stats)
  js/api.js             fetch wrapper for backend calls
  style.css             all visuals
```

## Setup

1. **Get a Riot API key** at [developer.riotgames.com](https://developer.riotgames.com) (dev keys expire every 24h; free to regenerate). Either:
   - Paste it in **Setup → Use for this session** (server memory only — gone when you stop the app), or
   - Put it in `.env` as `RIOT_API_KEY` so it survives restarts.

   Also set region defaults:

   ```powershell
   copy .env.example .env
   # edit RIOT_API_KEY (optional), RIOT_REGION (americas / europe / asia / sea), RIOT_PLATFORM (na1, euw1, kr, ...)
   ```

   Restart only needed after changing `.env`. The dashboard never gets the raw key back from the API.
2. **Install and run:**

   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --port 8000
   ```

4. Open [http://localhost:8000], enter your Riot ID (name + tagline), and hit **Sync match history**. The first sync takes a few minutes because dev keys are rate-limited to 100 requests per 2 minutes.

5. Queue up. When your game starts, the dashboard flips to the live view automatically (poll every 10 s). Keep it on a second monitor or alt-tab.

## Notes

- All Summoner's Rift 5v5 queues are synced (ranked solo/flex, normal draft/blind, quickplay). ARAM, arena, and bot games are skipped. Edit `SR_QUEUES` in `app/store.py` to change this.
- The "Play safe / Push hard" verdict needs at least 3 games of history against a champion; otherwise it falls back to your overall win rate on your current pick.
- The Stats tab tracks overall / ranked / normal win rates plus recently played champs. If ranked shows empty after this update, hit **Sync** once to attach queue info to older games.
- Data lives in `data/helper.db` (SQLite). Delete it to start fresh.
- Riot's terms: this app only reads data (live client + your match history), which is allowed. Don't use it to automate gameplay.
