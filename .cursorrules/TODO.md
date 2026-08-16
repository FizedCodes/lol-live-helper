# TODO / Roadmap

North star: **free in-game overlay** for everyone; deep Stats / Postgame / Player stay in a companion dashboard (local first, optional hosted site later). Don’t ship “overlay + cloud + AI” as one release.

```
Free 1.0 overlay  →  Live Client (:2999)
Companion (optional) → local or hosted dashboard + Riot key on server
Postgame death map → Match-V5 timeline (after the game; paid-friendly)
```

**Ports (don’t mix these up):**
- **8000** — this app’s dashboard (`uvicorn`)
- **2999** — Riot Live Client (League only while in a game)
- Timelines / death coords — Riot **Match-V5** web API (needs `RIOT_API_KEY`), not `:2999`

---

## A. Ship blockers for “1.0” (local product)

- [ ] **prod launcher** — `lolhelp.exe` or at least `lolhelp.cmd` so nobody types uvicorn
  <!-- done (partial 2026-07-25): Electron launcher in overlay-app/ (server + overlay + module toggles); lolhelp.cmd boots it; real .exe packaging next -->
- [ ] **auto-update** — check GitHub releases / version file so friends don’t rebuild from source
  <!-- next: wire into launcher after portable exe zip -->
- [ ] **first-run setup** — Riot ID + point to `.env` key in plain language; fail soft if key missing (Live/overlay still works)
- [ ] **Riot key pain** — document daily regen; later: personal key stays on user’s machine and only optional “upload for cloud Sync”
  <!-- done (partial): Setup session paste = memory-only for this uvicorn run; optional .env for persistence; never SQLite -->
- [ ] **remove leftover “op.gg” wording** — do before any public share
- [ ] **use League-friendly logos/icons** for live stats (careful with Riot asset rules)
- [ ] **smoke checklist** — Live / Sync / Player / Postgame / key status after every release

## B. Free overlay core (the real 1.0)

### Overlay shell
- [ ] **Windows overlay shell** — always-on-top, click-through toggle, hotkey show/hide, survives alt-tab into League
  <!-- done (partial 2026-07-25): Electron launcher+overlay; setIgnoreMouseEvents; module toggles stub for paid; pywebview = fallback -->
- [ ] **honest labels** — spell/camp timers stay click/schedule-based; never fake auto-detection Riot doesn’t give
- [ ] **overlay camp timers on map** — browser camps dock exists; real Windows overlay map still later

### Overlay v1 live stats (from Live Client `:2999` + Sync baselines)
- [ ] **matchup win rate + verdict** — personal WR vs lane opponent (SQLite), already on Live today → surface on overlay
  <!-- done (2026-07-25): free overlay shows laner WR + verdict -->
- [ ] **KDA** — live kills / deaths / assists
  <!-- done (2026-07-25): on free overlay -->
- [ ] **farm** — CS and CS/min from `creepScore` + `gameTime`
  <!-- done (2026-07-25): on free overlay -->
- [ ] **gold per minute** — your gold / game minutes (you; Live Client is richest for active player)
  <!-- done (2026-07-25): on free overlay -->
- [ ] **kill participation** — (K+A) / ally team kills this game
  <!-- done (2026-07-25): on free overlay -->
- [ ] **objectives** — ticks from Live `eventdata` (dragon, baron, towers, etc.)
  <!-- done (2026-07-25): /api/live objectives + overlay line -->

- [ ] **rank grind tracker** — wins till next rank, LP bar, last 5 W/L champ icons, session W-L / WR / net LP, optional grind timer
  <!-- want (ref 2026-07-25): Porofessor-style panel — “N wins till X”, Bronze II + LP badge + % bar, LAST 5 games, SESSION / WIN RATE / NET LP, grind clock + games; needs League-V4 + Match-V5 after ranked games, not Live Client alone -->

- [ ] **vision / ward score** — player ward score pace (Live); not full end-game vision score until Match-V5
  <!-- done (partial 2026-07-25): ward_score on scores + overlay; pace coach later -->
- [ ] **summoner spell tracker** — Flash/Heal/etc. click-to-arm CDs (see `.cursorrules/SpellTracker.md`)
  <!-- paid / later overlay QoL -->
- [ ] **camp / objective strip** — reuse camps schedule logic on the overlay
  <!-- paid / later overlay QoL -->

### Live habits (possible — sample Live Client over game clock)
Stats habits today are **end-of-sync averages only**. Live habits *can* timestamp when you fall behind — Riot gives continuous CS / KDA / ward score / events.

- [ ] **live habit coach** — compare current-game CS/min, ward-score pace, KP, your GPM to *your* Sync role baselines; nudge when weak
- [ ] **habit timestamps** — log the **game clock** when a metric crosses “weak” (e.g. CS deficit starts ~5:00); show on overlay + save for Postgame review
- [ ] **Stats ↔ overlay focus** — pin “habits I’m working on” from Stats ignore/focus list into overlay nudges
- [ ] **not live (be honest)** — “didn’t gank after clear”, exact ward *placement* tiles, death **map coords** mid-game (no Live Client positions)

### Later overlay
- [ ] **CS vs ranks / top players** [later] — needs external data or huge personal samples

## C. Companion dashboard (browser / later website)

- [ ] **UI revamp pass** — kill generic dark-card “AI dashboard” look; one visual language, denser Live, quieter Setup
- [ ] **declutter Live** — default: opponent + fight + spells; hide full both-teams behind “expand”
- [ ] **Builds clunk** — fewer words, clearer “buy next”; situational swaps as small chips not essays
- [ ] Shorten every tab’s intro paragraph to one line
- [ ] Live idle state: one CTA (“queue up”) not a tour of all tabs
- [ ] Consistent icon language (champ / spell / item) before more features
- [ ] **habit history UI** — show timestamped weak windows from live games (“you usually drop CS after 8:00”)

## D. Hosted website + client transmit (after overlay works)

- [ ] **thin client** — local agent reads `:2999`, optional encrypt/upload live snapshot to *your* backend
- [ ] **hosted frontend** — same tabs as today, but API is your cloud (Riot key on server for Sync/Player; Live data from user’s client)
- [ ] **opt-in only** — free overlay works offline; cloud is “if they want”
- [ ] **accounts / privacy** — simple Riot ID login + “wipe my data”; never store keys in the browser
- [ ] **rate limits / cost** — one shared Riot key for all users will die; plan per-user keys or paid tier before public cloud Sync

## E. Paid / Postgame extras (Match-V5 API pulls)

Timeline is **already fetched** for buy order (`timeline_cache` + `postgame.py`). Extend the same pull — do **not** invent a second Riot path.

- [ ] **death coords from Match-V5 timeline** — parse `CHAMPION_KILL` events (`position.x/y`, killer, victim, assists, time); map `participantId` → champ/name from match payload
- [ ] **Postgame death map UI** — pin your deaths on SR minimap (reuse camps minimap patterns); click pin → killer + assists + game time
- [ ] **“how you died”** — show **who** killed you (+ assists); *not* which ability (API doesn’t give that)
- [ ] **death patterns across games** — optional paid: “you die river a lot 10–15 min” from cached timelines
- [ ] AI coach on Postgame / live tips [later]
- [ ] broker APIs only if legal + worth it (personal Match-V5 first)
- [ ] teammate-shared spell timers
- [ ] ultimate trackers



---

## Suggested release order

| Phase | Name | Outcome |
|-------|------|---------|
| **0.8** | Local companion | Dashboard tabs + Riot service + session/env key <!-- shipped 2026-07-25 --> |
| **0.9** | Polish local app | Launcher, kill op.gg text, UI declutter, spell click-timers in browser Live <!-- partial 2026-07-25: lolhelp.cmd + free overlay shell; op.gg/UI/spells still open --> |
| **1.0** | Free overlay | Exe + overlay live stats (WR/KDA/CS/GPM/KP/objectives/vision) + live habit nudges <!-- stats HUD started 2026-07-25; habits + exe still open --> |
| **1.1** | Habit depth | Timestamped habit windows saved; Stats/Postgame show “when you usually fail” |
| **1.2** | Death map | Match-V5 timeline death coords on Postgame (paid-friendly) |
| **1.5** | Optional cloud | Hosted site; client transmit opt-in; Sync/Player on server |
| **2.0** | Paid extras | AI + death-pattern insights + more |

---

## Already shipped (archive — don’t rebuild)

- Smurf signals (tier×games, OTP, grind, ranked WR, KDA/CS)
- Fight card runes (you vs foe) + Compare vs dropdown
- Live fight/hover chips from championStats (you); enemies item-estimated
- Builds shopping list + situational swaps + optional build order
- Postgame tab (grades, graphs, opponent, buy order, cached reports)
- Stats habit bubbles from Match-V5 (ignore ✕) — *end-of-sync averages, not live yet*
- Match-V5 timeline fetch + cache — *used for item buy order only so far*
- Camps SR minimap pull-up (schedule, not real kill tracking)
- Player lookup last-30-days + Refresh / Clear cache
  <!-- done (2026-08-15): ranked LP gain/loss on match rows when we have before/after rank snapshots -->
- Riot API key server-only: Setup session paste (RAM) and/or `RIOT_API_KEY` in `.env` (see `.cursorrules/RiotApiRefactor.md`)
