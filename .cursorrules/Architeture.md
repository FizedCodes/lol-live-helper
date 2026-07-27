# Architecture

## Data flow
```
Browser (static/js/main.js, polls /api/live every 10s)
   │
   ▼
FastAPI (app/main.py — wiring only, ~40 lines)
   ├── routes_live.py    GET /api/live: live client data + matchup stats + verdicts + ranks + items
   │                     + activePlayer.championStats as live_stats (you only) + runes
   ├── routes_sync.py    POST /api/sync (match history pull), GET /api/stats
   ├── routes_player.py  GET /api/player?riot_id=: ranks, scored smurf signals
   │                     (tier×volume, OTP, grind, ranked WR, KDA/CS), recent matches
   ├── routes_postgame.py GET /api/postgame/list + /api/postgame?match_id=
   │                     (saved reports / match+timeline cache before Riot)
   └── routes_config.py  GET/POST /api/config (Riot ID), POST/DELETE /api/key (session), GET /api/key/status
        │                (POST /api/key disabled — env-only key)
        │
        ├── riot_service.py  Central Riot entry (session memory and/or env RIOT_API_KEY)
        ├── routes_riot.py   GET /api/riot/* primitives (account, league, match, timeline, key-status)
        ├── riot.py      HTTP clients: fetch_live_game() → https://127.0.0.1:2999 (self-signed cert,
        │                verify=False, returns None when not in game); RiotWebApi → Account-V1,
        │                Match-V5 (regional host), League-V4 (platform host); validate_key()
        │                All Riot web GETs go through rate_limit.py (shared 18/1s + 90/2min).
        ├── postgame.py  build_report() from Match-V5 (+ optional timeline)
        ├── rate_limit.py Sliding-window limiter shared by every RiotWebApi request
        ├── store.py     SQLite (data/helper.db): meta + matchups + matches (queue/time +
        │                perf: CS/vision/KDA/damage); matchup_stats(), champ_overall(),
        │                queue_win_rate(), summary() + performance_tracker(), record_match()
        ├── analysis.py  verdict(): thresholds MIN_GAMES_FOR_VERDICT=3, favored ≥55% WR, unfavored ≤45%
        ├── ranks.py     fetch_ranks(): Riot ID → puuid → league entries; module-level cache
        │                (ranks don't change mid-game); failures return None, never break /api/live
        └── config.py    settings from env; session key in RAM; never returned to browser
```

## Frontend (static/)
- `overlay.html` + `js/overlay.js` + `overlay.css` — free one-monitor HUD (`GET /overlay`).
- `overlay-app/` — Electron **launcher + overlay** (starts uvicorn, manages HUD);
  `launcher.html` is the control panel. Legacy fallback: `overlay_shell.py` (pywebview).
  Companion tabs stay in `index.html`.
- `index.html` — skeleton: header with tab nav (Live / Builds / Stats / Postgame /
  Player / Setup) + pills (key status, in-game status). Each tab is a `.tab-page`
  section; hash router in main.js shows one at a time (`#live`, `#builds`, `#stats`,
  `#postgame`, `#player`, `#setup`).
- `js/main.js` — entry point: tab router, event wiring, 10s live poll, 5min key-status poll.
  Keeps `lastLiveData` (live payload or last-game snapshot) for the Builds tab.
- `js/render.js` — pure HTML-string builders (playerRow, renderLive, renderSummary…).
- `js/items.js` — Data Dragon module: fetches current version + `item.json` + `champion.json`
  once per load (`ready` promise; pinned-version fallback). Exports icon URL helpers,
  `getItem()`/`getChampion()`, and `initItemTooltips()` (one shared hover tooltip; any element
  with `data-item-id` gets it — name, gold, stripped description).
- `js/builds.js` — Live shopping list from META core: inventory sync, situational
  swaps as enemies buy, optional timed build order (`<details>` + localStorage),
  situational alternatives for leftovers.
- `js/fight.js` — Live fight compare card: enemy dropdown, item-powered call,
  side-by-side rune setups (Data Dragon icons). Your chips use live
  `championStats` (incl. AH); enemies use item estimates.
- `js/hover.js` — champion hover panel: tip slider animation + stats from live
  client (you) or equipped items (others).
- `js/postgame.js` — Postgame tab: synced game history list + full report
  (grades, graphs, buy order). Reports persist in SQLite.
- `js/api.js` — fetch wrapper (`api()`, `post()`); throws Error with backend `detail` message.
- `style.css` — dark LoL-ish theme, CSS vars at top; fight compare, champ hover, order steps.
- Live: fight-compare card (you vs laner); clickable Riot IDs open player lookup card.
  After a game, open **Postgame** (Sync first).
- Player: Riot ID search box hitting `/api/player`.
- Stats: win rates + habit **bubbles** (detailed after-match reports are under Postgame).

## Important mechanics
- **Active player identification**: live client's `activePlayer.riotId` matched against `allPlayers`.
- **Lane opponent**: enemy with same `position` as user; sorted first, gold highlight.
- **Player recent matches**: `/api/player` indexes newest match IDs from the
  **last 30 days** (up to 70), loads **20** details per page (Load more via
  `next_start`). Finished Match-V5 JSON lives in SQLite `match_cache`. In-memory
  lookup keeps **ranks** ~5 min; **match-id list re-pulls on every first-page
  search** so a just-finished game shows up (Load more keeps the frozen list).
  UI: **Refresh games** (`?refresh=1`) and **Clear cache** (`POST /api/player/cache/clear`).
- **Last game replay**: every in-game poll snapshots the full `/api/live` payload to meta key
  `last_game` (JSON with `saved_at`). When not in game, that snapshot is returned and rendered
  with a "LAST GAME" banner; win/loss comes from the live client's `GameEnd` event when caught.
- **Matchup rows**: one row per (match, enemy champ); `is_lane_opponent` flag; remakes (<300s)
  and non-Summoner's-Rift queues skipped (`SR_QUEUES` in store.py: 400, 420, 430, 440, 490).
- **Matches rows**: one row per game with `queue_id` + `played_at` for ranked/normal WR and
  recently-played champions. Backfilled legacy rows use `queue_id=0` until the next sync.
- **API key**: server memory (Setup “Use for this session”) and/or `.env` `RIOT_API_KEY`.
  Session wins while set; both are process-only / env — never SQLite, never returned by
  `/api/config`. Header pill + Setup “Check key status” use `/api/key/status`.
  Riot HTTP re-reads the key on every request (no process-level key cache beyond session).

## Conventions
- Backend errors surface as HTTP 400 with human-readable `detail`; frontend shows them verbatim.
- riot.py raises `RuntimeError` with user-facing messages; routers convert to HTTPException.
- All SQLite access goes through `store.connect()` (creates schema on first use); connections
  are opened per-request and closed in `finally`.
