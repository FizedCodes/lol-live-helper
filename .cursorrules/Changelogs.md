# Changelog

## 2026-07-22 22:59 — Fight compare champ swap + rune setups
- **Fight card**: dropdown to compare vs any enemy (not only laner); selection sticks
  across the 10s live poll. Same card now shows both players' rune setups
  (keystone, trees, full perk row + shards when the live client provides them).
- **Data**: `/api/live` includes normalized `runes` per player; Data Dragon
  `runesReforged.json` powers icons/names in `items.js`. New `js/fight.js` owns
  the compare + runes UI. Combat chips also surface AS / crit / MS when items give them.

## 2026-07-22 22:35 — Player lookup fix + shared Riot rate limiter
- **Player match history**: lookups retry on 429, pull up to 20 games (14-day window),
  skip missing match files, sort by start time, and send `Cache-Control: no-store`.
  Each row shows relative time plus a local date/time; partial results warn explicitly.
  Practice-tool `#BOT` names are rejected.
- **Self-throttle**: every Riot web call shares one process-wide sliding-window limiter
  (default **18/1s** and **90/2min**, under personal-key caps). Override with
  `RIOT_RATE_LIMIT_*` env vars. 429 responses still honor `Retry-After`.
- **Live ranks**: still cached for the process lifetime; spacing now comes from the
  shared limiter instead of a separate concurrency cap.

## 2026-07-22 21:12 — Fight icons, recent matches, smurf check
- **Fight compare UI**: stat chips with icons (KDA/CS/gold/AD/AP/Armor/MR/HP) sit under
  each champ portrait; green/red tint shows who is ahead on that stat.
- **Player recent matches**: `/api/player` returns recent games (champ, W/L, KDA, CS,
  queue, time) rendered on the Player tab.
- **Smurf / playtime check**: summoner level + ranked game volume + hot recent WR as soft
  signals on the Player card (not proof — clearly labeled).

## 2026-07-22 20:59 — Player tab + you-vs-them items
- **Player tab**: one-click Riot ID lookup moved to its own `#player` tab (Live clicks jump there).
- **Item compare**: player card now shows your items and the looked-up player's items side by side
  (champ, KDA, CS, item gold + icons), refreshing from the live poll without re-calling Riot.

## 2026-07-22 (late) — build order, champ hover, fight compare, player lookup
- **Build order + paths**: Builds tab shows timed buy steps with component trees.
  Item tooltips and ↑ badges show what each item builds from / into (Data Dragon).
- **Champion hover panel**: hover a portrait for a sliding tip carousel, KDA/CS/gold,
  and combat stats summed from equipped items (`js/hover.js`).
- **Fight compare**: Live card compares you vs your lane opponent (KDA, CS, item gold,
  AD/AP/Armor/MR/HP) with a TAKE THE FIGHT / EVEN / PLAY SAFE call.
- **Player lookup**: click any Riot ID on Live, or search Name#Tag on Stats.
  New `GET /api/player` returns solo/flex rank + win rate (`routes_player.py`).

## 2026-07-22 (night) — win rate tracker + builds revamp
- **Win rate tracker**: new `matches` table stores queue + play time per game. `/api/stats`
  now returns overall / ranked / normals WR, per-champion table, and recently played champs.
  Live scoreboard shows compact Ranked + current-champ WR chips with a link to Stats.
  Next Sync upgrades older rows that lacked queue info (rate-limit aware).
- **Builds revamp**: META core for your champ's archetype (ADC, mage, assassin, tank, …)
  plus situational alternatives from enemy picks *and* what they've already bought
  (armor/MR stacks, healing, assassins).

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
