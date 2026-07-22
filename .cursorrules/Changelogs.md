# Changelog

## 2026-07-22
- **Enemy item tracker**: `/api/live` now includes each player's items from the live client;
  item icons render in every player row (updates within one 10s poll of a buy). Data Dragon
  version now fetched live (falls back to a pinned version). Build planner discussed but not built.
- **Docs**: filled `.cursorrules/` reference docs (Project, Architecture, Changelog).

## 2026-07-21 (evening) — modular restructure + in-site key management
- Split `app/main.py` (275 lines) into `routes_config.py`, `routes_sync.py`, `routes_live.py`,
  `analysis.py`, `ranks.py`, `config.py`; `main.py` is now wiring only.
- Split `static/app.js` into ES modules: `js/main.js`, `js/render.js`, `js/api.js`.
- API key can now be pasted in the site's Setup panel (validated against Riot, stored in DB,
  wins over `.env`, no restart needed). Header pill shows key alive/expired, rechecked every 5min.

## 2026-07-21 — feature buildout
- **Ranks**: League-V4 lookups (solo preferred, flex fallback) with lifetime cache; tier-colored
  badges. Added `RIOT_PLATFORM` env setting.
- **Side-by-side teams**: ally team left, enemy team right, collapsible panels, responsive.
- **Riot ID validation UX**: Save now shows "✓ Player found: Name#Tag" (canonical casing) or a
  clear not-found/expired-key error. Root cause of "entering my info does nothing".
- **Sync widened**: was ranked solo only (queue 420); now all SR 5v5 queues (400/420/430/440/490),
  still skipping ARAM/arena/bots and remakes.
- **Last game replay**: in-game payload snapshotted to DB each poll; shown with LAST GAME banner
  + VICTORY/DEFEAT when not in game.
- **Kill tracker + compact UI**: team kill scoreboard, game clock, per-player K/D/A + CS,
  dead players greyed, collapsible team sections.

## 2026-07-21 — initial scaffold
- FastAPI + SQLite backend, plain JS frontend, polling dashboard.
- Live game detection via Live Client Data API; personal matchup win rates from Match-V5;
  play safe / push hard verdicts (≥55% / ≤45%, min 3 games).
- Git repo initialized (first commit left to user — needed git identity setup).
