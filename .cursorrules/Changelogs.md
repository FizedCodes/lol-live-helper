# Changelog

## 2026-08-15 23:00 — Setup key check + in-game-only live probe
- **Failed to fetch** on Check key status: the launcher treated a broken `/api/live`
  (SQLite setup crash) as "server never started" and **killed uvicorn**, so Setup
  could not reach the helper. Ready-check now uses `/api/health` (no Live Client,
  no database). `/api/live` no longer 500s if the DB hiccups.
- **Check key status** uses the key in the paste box (same as **Use for this session**)
  instead of only checking a leftover server/.env key.
- No API key: Riot rank lookups stay skipped. Electron only pings Live Client
  (`/api/live?lite=1`) to detect a match — full overlay/dashboard fetch still
  runs in game. Out of game that lite call returns quickly with `in_game: false`.

## 2026-08-15 22:55 — **v0.9.5** LP gained/lost on Player lookup
- Ranked Solo / Flex games on the lookup page can show **+18 LP** / **-16 LP**
  (or Promo / Promoted) next to WIN/LOSS.
- Riot's match history has no LP field. We save a rank snapshot whenever we
  see someone in a live lobby or look them up, then fill LP when exactly one
  ranked game sits between two snapshots. After a game you played, **Refresh
  games** on that player is the usual way to get the number.
- Remakes show 0 LP. First search of a stranger often has no number yet.

## 2026-08-15 22:52 — Launcher console no longer shows garbled hotkey text
- The black window that opens with `lolhelp.cmd` was printing `play-through Γåö grab`
  because Windows cmd uses an old character set and couldn't show the `↔` arrow.
- Hotkey help now uses plain ` <-> ` so it reads correctly.

## 2026-08-09 15:40 — **v0.9.4** Fix Setup key paste when Riot quota is burned
- Root cause: live rank lookups **retried every poll** on failure (overlay ~2s,
  Electron ~1s). An expired key burned the 100-req / 2-min budget, so
  **Use for this session** got Riot 429 → 400 until the window cleared
  (looked like you had to spam the button).
- Rank failures now cool down for 90s; cache clears when you paste/clear a key.
- Setup still saves the session key if Riot is rate-limiting (only real
  401/403 rejects). Status checks are cached ~45s so the pill doesn't re-hit Riot.

## 2026-07-28 18:16 — Faster Player lookup
- Cold lookups were pulling match details **one at a time** (~20 Riot round-trips).
  Now fetches up to **6 matches in parallel** (still under the shared rate limit).
- Rank / level / match-id list calls overlap on first search.
- Match-id list no longer re-hits Riot on every re-search — only when older than
  ~90s, or when you press **Refresh games**.

## 2026-07-28 17:25 — Builds: pick a champ before games + show starters
- Builds tab has a **champion + role picker** so you can browse shopping lists
  before queue (no longer waits for live game / last-game data).
- **Follow live** snaps back to your current or last-game champ; picking
  someone else switches to preview mode.
- Each archetype now shows the usual **starter** (Doran's / Dark Seal /
  World Atlas / jungle pet) in the list and as step 1 of build order.

## 2026-07-27 22:46 — Fix session API key paste not accepting
- Key check no longer waits behind the Sync rate limiter (that made Setup hang
  after a big sync and look like the new key was rejected).
- Paste cleanup is stricter: strips all whitespace / quotes and pulls out the
  `RGAPI-…` bit if the clipboard also has a label.
- Key is only kept in memory after Riot accepts it; Setup field is plain text
  so you can see what you pasted; clearer error text in the UI.

## 2026-07-27 07:10 — **v0.9.3** Launcher auto-update from GitHub
- New **Updates** panel in the launcher: Check for updates / Update now.
- Pulls latest code with `git pull --ff-only`, refreshes pip deps if
  `requirements.txt` changed, then restarts the server (or relaunches Electron
  if launcher files changed).
- Blocks the update if you have local uncommitted edits so nothing gets overwritten.
- Quiet check a few seconds after open so status isn't empty.

## 2026-07-25 20:46 — Launcher: solid scroll background
- Scrolling the launcher showed a hard color cut through the dashboard button —
  the page used a short radial gradient over a darker window chrome. Now one
  solid `#0c1018` for the whole scroll.

## 2026-07-25 20:22 — Fix server dying right after start
- Launcher only waited 0.4s for cleanup, but `stop-server` takes longer — so it
  kept running and **killed the new uvicorn** (UI showed "exited code 1").
- Now waits for cleanup to finish before starting. Dashboard button stays
  clickable even when the server is down.

## 2026-07-25 20:15 — Fix launcher mass-kill on stop
- Root cause: PowerShell `Where-Object` put `-or` on a **new line** after a closed
  `(...)`. PS treated `-or` as a command name, the filter matched **every process**
  (~300 PIDs), and `Stop-Process` tried to close the whole session.
- `launcher_ctl.py` now matches targets in **Python** (port 8000 listener, our
  uvicorn / `overlay_shell`, Electron only with our `overlay-app` path). Added
  `dry-run` to list victims without killing.

## 2026-07-25 20:08 — Fix launcher suicide on start
- Electron called `launcher_ctl stop`, which matched `*lol-live-helper*` in its own
  path and **killed the launcher**. Now uses `stop-server` (port/uvicorn only) and
  never targets the running Electron process.

## 2026-07-25 20:03 — **v0.9.2** Electron launcher (control panel)
- `overlay-app` is now a full **desktop launcher**: starts/stops the FastAPI server,
  owns the overlay window, and exposes toggles for show/hide + play-through.
- Module switches stubbed for later (live stats free; rank grind / habits gated).
- Prefs in `data/launcher_prefs.json`. Closing the launcher quits everything.
- `lolhelp.cmd` just boots Electron (no separate uvicorn window).

## 2026-07-25 17:55 — Overlay stays up out of game
- HUD no longer auto-hides when you leave a match — so you can drag, resize, and
  tweak opacity in lobby / client before queueing.
- Only **Ctrl+Shift+O** hides it (both Electron + pywebview hosts). Entering a
  game un-hides if you had tucked it away.

## 2026-07-25 17:50 — **v0.9.1** Electron overlay host (no Overwolf)
- New `overlay-app/` — Electron window loads the same `/overlay` HUD with real
  `setIgnoreMouseEvents` click-through + transparent frame (keeps our HTML/CSS).
- `lolhelp.cmd` prefers Electron when installed; still falls back to
  `overlay_shell.py` (pywebview) if `npm install` wasn’t run.
- One-time: install Node LTS, then `cd overlay-app && npm install`.
- Still your app only — no Overwolf, no their ads.

## 2026-07-25 17:41 — Overlay: fix white flash + real play-through hit-test
- Root cause of **white screen** on Ctrl+Shift+I: stamping `WS_EX_TRANSPARENT` onto
  WebView2 child HWNDs breaks its compositor. Removed that approach entirely.
- Play-through now uses a Win32 **WM_NCHITTEST → HTTRANSPARENT** subclass so
  clicks skip the whole window (Porofessor-style *behavior*, not Overwolf tech).
- HUD **fills the window** so empty WebView margins can’t show as a white slab;
  oversized saved geom was reset.
- Honest limit: Porofessor runs on **Overwolf** (true in-game overlay host). Ours
  is still a floating always-on-top window.

## 2026-07-25 17:36 — Launcher: one terminal + auto-replace old build
- `lolhelp.cmd` no longer opens a separate minimized server window — uvicorn runs
  in the **same console** (`start /b`) with the overlay.
- Re-running the launcher **stops** any old `:8000` server / `overlay_shell` first
  (`launcher_ctl.py stop`), so you don’t hunt leftover processes.
- Closing the overlay (or Ctrl+C) also stops the server.

## 2026-07-25 17:33 — Overlay: click-through actually blocks drag/resize
- Ctrl+Shift+I was a no-op for the mouse: only the outer window got
  `WS_EX_TRANSPARENT`, so WebView2 children still ate drag/resize.
- Now stamps click-through on the full HWND tree, drops `WS_THICKFRAME` while
  play-through is on, re-applies if WebView2 remounts children, and shows a
  **gold outline + DRAG / RESIZE** label when grab mode is on.

## 2026-07-25 17:32 — Overlay: glass look + opacity slider
- HUD defaults to ~22% opacity (mostly see-through) with light text shadows so
  numbers stay readable over the map.
- **Opacity** slider on the HUD (saved in localStorage). Use **Ctrl+Shift+I**
  first so click-through is off, then drag the slider; toggle back when done.

## 2026-07-25 17:17 — Overlay: transparency + in-game keybinds
- **Keybinds:** pywebview was calling `Activate()` on transparent windows, which
  stole keyboard focus from League (Q/W/E/R / summs stop working). Patched to
  `ShowWindow(SW_SHOWNOACTIVATE)`, bounce focus back to `RiotWindowClass`, and a
  small focus watchdog while click-through is on.
- **Black box:** stopped forcing `WS_EX_LAYERED` ourselves — it fought WebView2’s
  per-pixel alpha and turned the clear margins into a solid black rectangle.
  Only the dark HUD card should paint now.
- If overlay hotkeys still fail in game, League may be Admin — run the overlay
  elevated too (Windows blocks hotkeys across that boundary).

## 2026-07-25 16:49 — Overlay: resizable + 5s hide delay
- Overlay stays visible **5 seconds** after Live Client drops (post-game grace).
- Resize: `WS_THICKFRAME` + `min_size`; use **Ctrl+Shift+I** first so click-through
  is off, then drag the window edges.

## 2026-07-25 16:35 — Overlay: drop fullscreen purple (WebView2 can't chroma-key)
- Fullscreen magenta chroma-key **does not work** with WebView2 — you got a purple
  lock-in screen. Removed that approach entirely.
- Back to a **floating dark HUD** (top-right, ~380×320). No focus stealing, no
  SetForegroundWindow to League. Click-through still default; Ctrl+Shift+I to drag.
- Honest limit: true glass transparency over the whole game needs a non-WebView2
  shell later (exe / native). For now the card is opaque and playable.

## 2026-07-25 16:27 — Overlay: don't steal League keyboard focus
- Click-through only passes **mouse** — keyboard always goes to whichever window
  is focused. Showing the overlay with `SW_SHOW` was activating it, so League
  stopped seeing Q/W/E/R / summs.
- Fix: `WS_EX_NOACTIVATE` + `SW_SHOWNOACTIVATE`, then hand focus back to the
  League client (`RiotWindowClass`). Restart overlay_shell to pick this up.

## 2026-07-25 16:16 — Overlay: fullscreen + chroma-key transparency
- Overlay window is now **fullscreen** on the primary monitor (not a tiny corner).
- Stats are spread out: matchup card (top-right), big KDA/CS/GPM strip (bottom),
  objectives (top-center) — no more compressed single box.
- Windows transparency uses **magenta chroma-key** (`#FF00FF` punched out) so the
  game shows through; only the dark HUD panels stay. WebView2 alpha is unreliable.
- Still auto-hides out of game; click-through + hotkeys unchanged.

## 2026-07-25 15:57 — Overlay: auto-hide out of game + less white box
- Overlay **hides while you're not in a match** (it can't live inside the Riot
  client window — it's a separate always-on-top HUD that appears over the game).
- `Ctrl+Shift+O` can still force-show for peek/reposition.
- Transparency: set `WEBVIEW2_DEFAULT_BACKGROUND_COLOR=0`, `shadow=False`, layered
  toolwindow styles. WebView2 on Windows is still flaky for true glass; the HUD
  card itself is an opaque dark panel so you shouldn't see a giant white rectangle.

## 2026-07-25 15:54 — Launcher wait false-fail (Live Client timeout)
- Root cause: `/api/live` waits on League `:2999` when you're not in game; that
  took ~2–3s, but `wait_server.py` / the cmd probe used a **1.5s** HTTP timeout,
  so the launcher always said “Waiting for server…” then failed.
- Live Client probe now fails fast (`connect=0.4s`); waiter uses an 8s timeout
  and prints progress. Uvicorn stdout goes to `data/server.log`.
- Overlay fix: pywebview rejects `#00000000` — use `#000000` with `transparent=True`.

## 2026-07-25 15:48 — Launcher: port conflict + wait fix
- `lolhelp.cmd` now **reuses** a healthy server already on `:8000` instead of
  starting a second uvicorn (that caused WinError 10048).
- Wait loop moved to `wait_server.py` (batch `timeout`/`errorlevel` was flaky).
- Clearer message when the port is stuck or `/overlay` is missing on an old process.

## 2026-07-25 15:24 — **v0.9.0** free overlay shell + one-click launcher
- Double-click **`lolhelp.cmd`**: starts the local server, opens the companion
  dashboard in your browser, and opens a **free always-on-top overlay**.
- Overlay shows simple in-game stats only: lane opponent WR + verdict, KDA, CS,
  CS/min, GPM, KP, ward score, gold, and an objectives line.
- Hotkeys: **Ctrl+Shift+O** show/hide, **Ctrl+Shift+I** toggle click-through
  (clicks pass through to League by default — one-monitor friendly).
- New files: `overlay_shell.py`, `static/overlay.html`, `static/overlay.css`,
  `static/js/overlay.js`; `GET /overlay` in `main.py`.
- `/api/live` now includes `ward_score` on scores and an `objectives` summary
  from Live Client events.
- Companion tabs (Player / Sync / Postgame / etc.) stay in the browser — richer
  overlay QoL is later / paid-track, not in this free HUD.
- Still a `.cmd` launcher (real `.exe` later for August friends build).

## 2026-07-25 09:18 — **v0.8.0** release
Local companion dashboard milestone: Riot calls go through a server-side service;
API key is session-memory and/or `.env` (never SQLite, never returned to the browser);
Player refresh/clear-cache + fresher match lists; postgame / habits / builds already in tree.

## 2026-07-25 09:15 — Session API key (memory only, no save)
- Setup has a paste box again: **Use for this session** keeps the key in server
  RAM only — not SQLite, not `.env`, gone when you stop uvicorn.
- Optional `.env` `RIOT_API_KEY` still works and survives restarts; session key
  wins while set. **Clear session key** drops memory and falls back to env.
- `/api/config` still never returns the raw key; input is cleared after handoff.

## 2026-07-25 08:05 — Riot API key is server-only + central service
- API key lives only in server `.env` (`RIOT_API_KEY`). Setup no longer pastes/saves a key;
  the browser never receives the raw key from `/api/config`.
- New `riot_service.py` is the single entry for Riot ops; thin `GET /api/riot/*` endpoints
  wrap the same service. Feature tabs still use `/api/live`, `/api/sync`, `/api/player`, etc.
- Review / rollback notes: `.cursorrules/RiotApiRefactor-Review.md`.
- **Migration:** if you only had a Setup-saved key, copy it into `.env` and restart.

## 2026-07-24 22:55 — Player Refresh games + Clear cache
- Player card actions: **Refresh games** (full re-pull from Riot) and **Clear cache**
  (wipes local memory + SQLite match blobs for that player, then re-pulls).
- Use after you finish a game so the new match shows up without waiting out the
  old cache. Close renamed so it isn’t confused with Clear cache.

## 2026-07-24 22:52 — Player re-search picks up new games
- Searching a player again **re-checks the match list** (so a game you just finished
  shows up). Ranks still stay warm ~5 min to spare the API key. Load more is unchanged.
- Pill text now says “cached ranks” so it’s clear the match list is not frozen.

## 2026-07-24 22:05 — API key Save no longer sticks on a stale token
- **Setup → Save key**: cleans copy-paste junk, only treats Riot 401/403 as a
  bad key (rate limits / glitches no longer look like “rejected”), and confirms
  the new key actually landed in the DB.
- **Live requests**: Riot calls re-read the key every time (no frozen header from
  when Sync/Player started), so a mid-session key swap is used immediately.
- Error text no longer tells you to edit `.env` and restart for a site-saved key.

## 2026-07-24 19:58 — Player match history stability (last 30 days)
- **Scope**: Player lookup only indexes games from the **last 30 days** (month-old
  and older are dropped, not mixed in).
- **Stability**: list stays in Riot newest-first order; Load more uses `next_start`
  (id index) instead of “how many rows we happened to get.”
- **UI**: re-search no longer clears the match list mid-load (that looked like
  history jumping around). Label shows “last 30 days.”

## 2026-07-23 17:40 — Postgame is its own lasting tab
- **New Postgame tab**: synced games stay in a scrollable history — click any
  game for grades / graphs / buy order. Reports + timelines save locally so
  they don’t vanish after the next match.
- Removed the disappearing post-game block from Live and Stats (Stats keeps
  habits; Live links to Postgame after a game).
- APIs: `GET /api/postgame/list`, `GET /api/postgame?match_id=` (uses report /
  match / timeline caches before Riot).

## 2026-07-23 10:35 — Match cache + Load more (save the dev key)
- **SQLite `match_cache`**: finished games are stored once and reused by Player
  lookup and Sync — no re-download of the same match_id.
- **Player memory (~5 min)**: re-searching the same Riot ID skips account/rank/id
  list calls for a bit (ranks don’t change that fast).
- **Paging**: first load pulls **20** games; **Load more** grabs the next 20 from
  a 70-id index. Progress bar still shows. (No production Riot key needed.)

## 2026-07-23 10:28 — Progress bars for Player lookup + Sync
- **Player search**: streams match loading with a real **X / 70** progress bar
  (ranks show first, then matches fill in).
- **Setup Sync**: same style bar while new matches are stored.
- Backend: `?stream=1` NDJSON on `/api/player` and `/api/sync`.

## 2026-07-23 10:08 — Camp pull-up dock + denser match history
- **Camps**: map moved to a fixed **bottom-right pull-up** (small Camps tab + ▲/▼).
  Open/closed remembered in localStorage; stays out of the Live scroll.
- **Player recent matches**: now fetches the newest **70** games (was 20) with no
  14-day startTime filter, so active accounts don’t look sparse. Personal Sync
  default index raised to **250** (override with `SYNC_MATCH_COUNT`). Restart the
  server, then re-search a player / hit Sync for the fuller lists.

## 2026-07-23 09:48 — Camp schedule on the Rift map
- **Camp UI**: schedule is no longer a text list — pins sit on the real Summoner's
  Rift minimap (Community Dragon map11) with buff / camp / dragon / baron icons.
  Both jungles + river; top pit swaps Grubs → Herald → Baron by game clock.
  Still a schedule from `game_time`, not tracked clears. Also shows on last-game
  replay so you can check the map out of game.

## 2026-07-23 08:20 — Live cleanup + in-app camp schedule
- **Live UI**: tighter scoreboard / fight / team rows (less padding, rank+lane on one
  line with champ name, enemies listed first). Same dark theme — just denser and
  easier to scan mid-game.
- **Camp schedule (v1)**: new Live panel while in-game (`static/js/camps.js`) shows
  typical spawn/respawn countdowns from live `game_time` for Blue/Red, Gromp,
  Wolves, Raptors, Krugs, Dragon, Voidgrubs, Herald, and Baron. Labeled as a
  **schedule** (not tracked clears — Live Client doesn’t give reliable camp kills).
  True Windows overlay + CS-vs-ranks still later.

## 2026-07-23 01:52 — Stats page fix: habits bubbles + after-match graphs
- **Bugfix**: running server was missing `GET /api/postgame` (404) and the DB
  lacked performance columns, so habits never unlocked. Restart migrates the
  `matches` table; hit **Sync** once to backfill CS/vision/KP stats.
- **Habits UI**: tracker now shows compact circular **bubbles** (grade + value),
  weak ones edged red; ignore ✕ still works.
- **After-match graphs**: post-game report adds bar charts — you vs lane opponent
  and this game vs your champ average — plus the existing table / item order.

## 2026-07-23 01:40 — Post-game report
- **Post-game**: `GET /api/postgame` loads your latest synced match + timeline.
  Shows Win/Loss, weak grades (CS/vision/KP/damage/KDA), you vs lane opponent
  compare (gold, turrets, KP…), objective chips, final items, and buy order for
  both players. Also compares this game to your personal champ average.
- **UI**: report on Live (after the game / last-game view) and on Stats.
  Sync refreshes it. Tests in `tests/test_postgame.py`.

## 2026-07-23 01:10 — op.gg-style habit tracker (Riot data)
- **Stats tab**: personal habit tracker grades CS/min, vision/min, kill
  participation, damage share, and KDA vs soft role baselines. Weak habits are
  highlighted; ✕ ignores a metric locally. Per-role breakdowns included.
- **Sync**: Match-V5 rows now store CS, vision, KDA, damage, team totals.
  Older games upgrade on the next Sync (`perf_ready`). Built from your Riot
  history — same idea as op.gg tracking, no scraping.

## 2026-07-23 00:20 — Stronger smurf / account-check signals
- **Player card**: smurf check is now scored across more patterns — high elo on a
  thin ranked sample, level×tier mismatch, season WR on a small sample, ranked-only
  hot streaks, games/day grind, OTP / tiny champ pool, inflated KDA, high CS/min.
  Severity is **ok / worth a glance / possible smurf** (not every soft flag alone).
- **Tests**: `tests/test_smurf.py` covers normal, Emerald-thin, OTP-hot, and soft
  low-volume cases.

## 2026-07-22 23:55 — Dynamic builds shopping list + optional order
- **Builds remake**: tab is now a live **shopping list** — greys owned items,
  gold-rings components you're building, highlights buy-next, and **swaps**
  unfinished META slots for situational counters as enemies buy armor/MR/heal
  (antiheal, pen, defense). Swap notes explain what replaced what.
- **UX**: your current inventory strip; build order collapsed behind an optional
  `<details>` (choice remembered); dropped "Mythic" wording; first-back always
  shows component trees (no empty step). Alternatives section hides items already
  slotted into the list.

## 2026-07-22 23:45 — Live combat stats + ability haste
- **Your chips**: fight compare and champ hover now prefer live client
  `championStats` for you (real AD/AP/Armor/MR/current HP, attack speed,
  crit, move speed, **ability haste**, level). Enemies stay item-estimated;
  chip tooltips say which source is in use. Fight call still compares item
  gold/bonuses so base stats don't skew TAKE THE FIGHT / PLAY SAFE.
- **Data**: `/api/live` attaches `live_stats` (+ level) on you / `me` from
  `activePlayer.championStats`.

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
