# LoL Live Helper

A local dashboard that shows your matchup context **while you're in a League of Legends game**: for every enemy champion it shows your personal win rate against them (overall, as a lane opponent, and on your current champion), and gives a simple call — **Push hard**, **Even**, or **Play safe**.

## How it works

- **Live game detection** uses Riot's [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api), which the League client serves locally at `https://127.0.0.1:2999` while you're in a game. No API key needed for this part.
- **Matchup stats** are built from *your own* ranked history via Riot's Match-V5 API. This needs a (free) API key. Riot doesn't publish global matchup win rates through the API, so the numbers here are personal — which is arguably more useful: they reflect how *you* actually do into each champion.

## Code layout

```
app/                    Python backend (FastAPI)
  main.py               wiring only: creates the app, mounts routes + static files
  routes_config.py      /api/config + /api/key endpoints (Riot ID, API key)
  routes_sync.py        /api/sync + /api/stats (match history)
  routes_live.py        /api/live (the in-game view)
  analysis.py           play safe / push hard verdict rules (tune thresholds here)
  ranks.py              League-V4 rank lookups, cached per server run
  riot.py               HTTP clients for Riot's APIs (live client + web API)
  store.py              SQLite persistence and matchup aggregation
  config.py             settings: env vars + the DB-stored API key
static/                 Frontend (plain HTML/CSS/JS, no build step)
  index.html            page skeleton
  js/main.js            entry point: event wiring + 10s polling loop
  js/render.js          pure HTML-building functions
  js/api.js             fetch wrapper for backend calls
  style.css             all visuals
```

## Setup

1. **Get a Riot API key** at [developer.riotgames.com](https://developer.riotgames.com) (dev keys expire every 24h; you can regenerate for free). You can paste it straight into the dashboard's Setup panel — no `.env` needed. Optionally set region defaults:

   ```powershell
   copy .env.example .env
   # edit RIOT_REGION (americas / europe / asia / sea) and RIOT_PLATFORM (na1, euw1, kr, ...)
   ```

2. **Install and run:**

   ```powershell
   python -m venv .venv
   .venv\Scripts\Activate.ps1
   pip install -r requirements.txt
   uvicorn app.main:app --port 8000
   ```

4. Open [http://localhost:8000](http://localhost:8000), enter your Riot ID (name + tagline), and hit **Sync match history**. The first sync takes a few minutes because dev keys are rate-limited to 100 requests per 2 minutes.

5. Queue up. When your game starts, the dashboard flips to the live view automatically (poll every 10 s). Keep it on a second monitor or alt-tab.

## Notes

- All Summoner's Rift 5v5 queues are synced (ranked solo/flex, normal draft/blind, quickplay). ARAM, arena, and bot games are skipped. Edit `SR_QUEUES` in `app/store.py` to change this.
- The "Play safe / Push hard" verdict needs at least 3 games of history against a champion; otherwise it falls back to your overall win rate on your current pick.
- Data lives in `data/helper.db` (SQLite). Delete it to start fresh.
- Riot's terms: this app only reads data (live client + your match history), which is allowed. Don't use it to automate gameplay.
