# Architecture

## Data flow
```
Browser (static/js/main.js, polls /api/live every 10s)
   │
   ▼
FastAPI (app/main.py — wiring only, ~40 lines)
   ├── routes_live.py    GET /api/live: live client data + matchup stats + verdicts + ranks + items
   ├── routes_sync.py    POST /api/sync (match history pull), GET /api/stats
   └── routes_config.py  GET/POST /api/config (Riot ID), POST /api/key, GET /api/key/status
        │
        ├── riot.py      HTTP clients: fetch_live_game() → https://127.0.0.1:2999 (self-signed cert,
        │                verify=False, returns None when not in game); RiotWebApi → Account-V1,
        │                Match-V5 (regional host), League-V4 (platform host); validate_key()
        ├── store.py     SQLite (data/helper.db): meta key/value table + matchups table;
        │                matchup_stats(), champ_overall(), summary(), record_match()
        ├── analysis.py  verdict(): thresholds MIN_GAMES_FOR_VERDICT=3, favored ≥55% WR, unfavored ≤45%
        ├── ranks.py     fetch_ranks(): Riot ID → puuid → league entries; module-level cache
        │                (ranks don't change mid-game); failures return None, never break /api/live
        └── config.py    settings: env vars + DB-stored API key (site key wins over .env)
```

## Frontend (static/)
- `index.html` — skeleton: header pills (key status + in-game status), setup card (Riot ID, sync, API key), scoreboard, two side-by-side `<details>` team panels, idle card.
- `js/main.js` — entry point: event wiring, 10s live poll, 5min key-status poll.
- `js/render.js` — pure HTML-string builders (playerRow, renderLive, renderSummary…). Champion/item icons from Data Dragon CDN.
- `js/api.js` — fetch wrapper (`api()`, `post()`); throws Error with backend `detail` message.
- `style.css` — dark LoL-ish theme, CSS vars at top; rank tier colors; `#teams` grid for side-by-side.

## Important mechanics
- **Active player identification**: live client's `activePlayer.riotId` matched against `allPlayers`.
- **Lane opponent**: enemy with same `position` as user; sorted first, gold highlight.
- **Last game replay**: every in-game poll snapshots the full `/api/live` payload to meta key
  `last_game` (JSON with `saved_at`). When not in game, that snapshot is returned and rendered
  with a "LAST GAME" banner; win/loss comes from the live client's `GameEnd` event when caught.
- **Matchup rows**: one row per (match, enemy champ); `is_lane_opponent` flag; remakes (<300s)
  and non-Summoner's-Rift queues skipped (`SR_QUEUES` in store.py: 400, 420, 430, 440, 490).
- **API key resolution order**: DB meta `api_key` (saved from site) → `RIOT_API_KEY` in `.env`.

## Conventions
- Backend errors surface as HTTP 400 with human-readable `detail`; frontend shows them verbatim.
- riot.py raises `RuntimeError` with user-facing messages; routers convert to HTTPException.
- All SQLite access goes through `store.connect()` (creates schema on first use); connections
  are opened per-request and closed in `finally`.
