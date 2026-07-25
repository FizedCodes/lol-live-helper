# Feature write-up — Summoner spell tracker

**Status:** design (not built yet)  
**TODO:** `--summoner spell tracker flash, heal, etc.`  
**Started:** 2026-07-24 21:16  

## What you want

While in a game, see **Flash / Heal / Ignite / TP / etc.** for everyone (especially enemies), and know **roughly when those spells come back up** so you can play around them — same idea as Porofessor / Blitz-style timers, but inside this local dashboard.

## How this fits the app today

| Related piece | What it does | Lesson for spells |
|---------------|--------------|-------------------|
| Live scoreboard (`render.js`) | Champ, KDA, items, verdict — **no spell icons yet** | Natural place to show D/F icons on each player row |
| Camp schedule (`camps.js`) | Timers from **game clock** only; labeled as a schedule, not tracked kills | Be honest when we can’t auto-detect “used” |
| Live Client (`/api/live`) | Already polls every ~10s; has `game_time`, players, items, runes | Can pass spell **names/ids** through; still no auto CD |
| Data Dragon (`items.js`) | Loads item / champ / rune JSON + icons | Add `summoner.json` the same way for icons + base CDs |

## Hard limit (important)

**Riot’s Live Client does not tell us when someone used a summoner spell.**

It *does* tell us which two spells each player took (`summonerSpellOne` / `summonerSpellTwo` on the player list). It does **not** expose cooldown remaining or a reliable “Flash used” event for enemies.

So v1 cannot be fully automatic like camp *spawn* times. It has to be **you click when you see them use it** (or a short “used ~7s ago” adjust), then we count down from a known base cooldown.

Same honesty rule as camps: label it clearly so it doesn’t pretend to be magic.

## Goal for v1 (ship something useful)

1. Show each player’s two summoner icons on the Live scoreboard (enemies first priority; allies optional).
2. Click an enemy spell icon → start a cooldown timer for that spell.
3. Show remaining time on the icon (greyed / pie / number) until it’s ready again.
4. Click again (or a small ✕) to clear a wrong timer.
5. Optional: **−30s** / **+ adjust** if you clicked late (common in other trackers).
6. Timers live in the **browser** for this game only (survive the 10s poll; wipe when the game ends / new game starts).

Out of scope for v1:

- Windows overlay / always-on-top HUD (that’s the separate “overlay system” TODO)
- Sharing timers with teammates over the network
- Ultimate cooldowns
- Perfect haste from every rune/item edge case (see haste below)

## Cooldown math (simple version)

- Load base CDs from Data Dragon `summoner.json` (Flash 300, Ignite 180, Heal 240, etc.).
- **Teleport** scales with champion level — use the player’s level from Live Client when starting the timer.
- **Summoner spell haste** (shorten the CD):
  - Cosmic Insight rune → yes if we already have their runes (we do for keystone/trees; may need the Insight perk id check)
  - Ionian Boots of Lucidity in their items → yes (we already pass items)
  - Formula: `effective = base / (1 + haste/100)`
- Ignore rarer sources in v1 (Cloud soul, ARAM aura, etc.) unless easy later.

Wrong by a few seconds is fine; wrong by a full minute is not — prefer readable haste over guessing.

## Where it should live in the UI

**Recommended:** icons on each **enemy player row** (next to champ portrait or items), clickable to arm the timer. Lane opponent highlighted like today.

**Optional companion:** a small “Spells” strip (ready / on CD) under the scoreboard so you don’t hunt five rows mid-fight. Can come in v1.1 if the row icons feel crowded.

Not a second camps-style map pin board — spells belong to people, not map spots.

## Backend vs frontend

| Layer | Work |
|-------|------|
| `routes_live.py` | Include each player’s two spells in the `/api/live` payload (id + display name from Live Client). No CD state on the server. |
| `items.js` (or small `spells.js`) | Fetch `summoner.json` once; icon URL helper; base CD + name lookup. |
| `spells.js` (new) | Timer state (Map by `riot_id` + slot), click handlers, tick every 1s from `game_time` or `Date.now()`, render overlays on icons. |
| `render.js` / `main.js` | Render spell slots on rows; wire init once; keep timers across re-renders (like fight compare’s selected enemy). |
| `style.css` | Compact icons, CD overlay, ready vs down states. |

No SQLite / Sync / Riot web API needed for v1 — this is Live Client + Data Dragon + local clicks only. Works even with an expired API key.

## Game / last-game behavior

- **In game:** full tracker.
- **Last-game replay:** show which spells they had (icons), but don’t keep running fake CDs unless we snapshot armed timers (nice-to-have; skip in v1).
- **New game:** clear all armed timers when `in_game` flips or champion/roster changes.

## Acceptance checklist (when we build it)

- [ ] Enemy rows show correct D/F icons from the live game
- [ ] Click starts countdown; number counts down; icon looks “down”
- [ ] Timer survives Live’s 10s re-render
- [ ] Clear / wrong-click recovery works
- [ ] Flash vs Ionian / Cosmic Insight shortens CD in an obvious way
- [ ] Note in UI: “Click when used — Live Client doesn’t auto-track”
- [ ] Changelog entry + TODO annotated done when shipped

## Open choices (decide before coding)

1. **Enemies only vs everyone?** Suggestion: enemies required; allies optional toggle later.
2. **Adjust buttons (−30s)?** Suggestion: yes for v1 — late clicks are common.
3. **Haste depth?** Suggestion: boots + Cosmic Insight only in v1.
4. **Separate dock vs row icons?** Suggestion: row icons first; strip only if needed.

## Build order (when ready to implement)

1. Pass spells through `/api/live` + show static icons on enemy rows  
2. Load `summoner.json` + base CDs  
3. Click → arm timer + 1s UI tick  
4. Haste from boots / Cosmic Insight  
5. Adjust / clear + polish CSS  
6. Docs: changelog + TODO `<!-- done: … -->`

## Not this feature

- Camp / objective overlay (already camps dock; Windows overlay still later)  
- Habit tracker timestamps (separate TODO)  
- Prod build / updater (separate TODOs)
