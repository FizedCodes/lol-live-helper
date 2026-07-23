# Changelog

## 2026-07-22 (evening) — tabs, item tooltips, counter builds
- **Tabs**: header nav (Live / Builds / Stats / Setup) using URL hashes (`#live`, `#builds`, …)
  so each view is linkable. Stats summary and Setup card moved out of the main page into
  their own tabs; small hash router in `js/main.js`.
- **Item system fleshed out**: new `js/items.js` loads Data Dragon `item.json` +
  `champion.json` once per page load. Hovering any item shows a styled tooltip
  (name, gold cost, cleaned-up description). Player rows show total item gold;
  trinkets get a gold border. Champion/item icon URL helpers moved here from render.js.
- **Player names**: each player's Riot ID now renders under the champion name.
- **Counter-builds tab**: new `js/builds.js` — rules-based item suggestions against the
  current (or last) enemy team: armor vs AD-heavy comps, MR vs AP-heavy, anti-heal vs
  healers (curated list), pen vs 2+ tanks, defensive items vs 2+ assassins. Suggestions
  adapt to whether the user's champion is AD/AP/tank. Curated item IDs are filtered
  against item.json so removed items drop out silently on new patches.

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
