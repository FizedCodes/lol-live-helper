# Riot API refactor — review notes

**Date:** 2026-07-25 08:05  
**Goal:** Centralize Riot calls behind a server-side service, keep the API key in a server-only env var, stop exposing/saving the key from the browser. UI tabs should behave the same (Live / Sync / Player / Postgame / Stats).

Use this file if something breaks after pull/restart — check the matching section.

---

## What you must do once (migration)

If you previously pasted a key in **Setup → Save key**, that SQLite copy is **no longer used**.

1. Open `.env` (copy from `.env.example` if needed).
2. Set a real key:
   ```
   RIOT_API_KEY=RGAPI-...
   ```
3. **Restart** the uvicorn process (env is loaded at startup via `load_dotenv()`).
4. Open Setup → **Check key status** (or look at the header pill).

If Sync / Player / Save Riot ID fail with “No Riot API key configured”, the env key is missing or still the placeholder.

---

## Architecture after this change

```
Browser  →  only /api/* (never Riot, never the raw key)
              │
              ├─ feature routes: /api/live, /api/sync, /api/player, /api/postgame, /api/config
              ├─ thin Riot primitives: /api/riot/*
              └─ key status: /api/key/status  (same as /api/riot/key-status)
                    │
                    ▼
              app/riot_service.py   ← single entry point
                    │
                    ▼
              app/riot.py           ← HTTP + rate limit + X-Riot-Token from RIOT_API_KEY
```

Live Client (`127.0.0.1:2999`) is unchanged and still needs no key.

Data Dragon / Community Dragon in the frontend are unchanged (public CDN, not Riot API).

---

## Files changed

### New

| File | Purpose |
|------|---------|
| `app/riot_service.py` | Central service: key status, account, summoner, league, match ids/match/timeline, live game |
| `app/routes_riot.py` | `GET /api/riot/*` thin wrappers around the service |
| `.cursorrules/RiotApiRefactor-Review.md` | This review doc |

### Backend touched

| File | Change |
|------|--------|
| `app/config.py` | Key **only** from `RIOT_API_KEY`. Removed SQLite `api_key` read/write and `save_api_key`. |
| `app/riot.py` | Error text points at `.env` + restart (not Setup paste). |
| `app/routes_config.py` | `GET /api/config` no longer returns `api_key`. `POST /api/key` returns 400 with migration message. Status uses `riot_service`. Save Riot ID uses `riot_service.get_account`. |
| `app/routes_live.py` | Uses `riot_service.fetch_live_game`. |
| `app/ranks.py` | Uses `riot_service` for account + league; skips ranks if no env key. |
| `app/routes_sync.py` | Builds client via `riot_service.web_api`. |
| `app/routes_player.py` | Account / summoner / league / match ids via `riot_service`; match detail still via `RiotWebApi` instance from service. |
| `app/routes_postgame.py` | Uses `riot_service.web_api` when cache miss. |
| `app/main.py` | Registers `routes_riot` router. |

### Frontend touched

| File | Change |
|------|--------|
| `static/index.html` | Removed key text input + Save key. Added env instructions + **Check key status** button. |
| `static/js/main.js` | Removed save-key / fill-from-config key logic. Check button + pill still call `/api/key/status`. |

### Docs

| File | Change |
|------|--------|
| `README.md`, `.cursorrules/Architeture.md`, `.cursorrules/Project.md`, `.env.example`, `.cursorrules/Changelogs.md`, `.cursorrules/TODO.md` | Env-only key wording |

---

## New / changed HTTP endpoints

| Method | Path | Notes |
|--------|------|--------|
| GET | `/api/riot/key-status` | Same payload as `/api/key/status`; never returns the key |
| GET | `/api/riot/account?game_name=&tag_line=` | Account-V1 |
| GET | `/api/riot/summoner/{puuid}` | Summoner-V4 |
| GET | `/api/riot/league/{puuid}` | League-V4 |
| GET | `/api/riot/matches?puuid=&count=` | Match id list |
| GET | `/api/riot/match/{match_id}` | Full match |
| GET | `/api/riot/match/{match_id}/timeline` | Timeline |
| POST | `/api/key` | Body `{ api_key }` → server **memory only** for this process; never SQLite |
| DELETE | `/api/key` | Clears session key; env key (if any) still applies |
| GET | `/api/config` | Riot ID + `has_api_key` + `key_source` (`session` / `env` / null) — **never** raw key |

Unchanged feature endpoints (still what the tabs use):  
`/api/live`, `/api/sync`, `/api/stats`, `/api/player`, `/api/postgame`, `/api/postgame/list`, `/api/key/status`.

---

## Behavior that should still work

- Header **API key** pill (polls `/api/key/status`)
- Setup: save Riot ID, Sync match history
- Live poll + ranks (when key valid)
- Player lookup / Load more / Refresh / Clear cache
- Postgame list + report (cache or Riot on miss)
- Stats from synced SQLite

## Behavior that intentionally changed

| Before | After |
|--------|--------|
| Paste key in Setup; stored in SQLite; shown back in the input | Key only in server `.env` **or** Setup session memory; UI never gets the raw key back |
| Save key mid-session without restart | Session paste applies immediately; `.env` still needs restart |
| `GET /api/config` included plaintext `api_key` | Config returns Riot ID + `has_api_key` + `key_source` only |

---

## If something breaks — quick checks

1. **Pill says No API key** → `.env` missing `RIOT_API_KEY`, or still `RGAPI-your-key-here`, or server not restarted after edit.
2. **Pill says Key expired** → regenerate at developer.riotgames.com, update `.env`, restart.
3. **Save Riot ID / Sync / Player fail with key errors** → same as above (all go through `riot_service` → env key).
4. **Live works but ranks empty** → often missing/invalid key (`ranks.fetch_ranks` soft-skips); matchup numbers still come from Sync/SQLite.
5. **Old DB meta `api_key` still in SQLite** → harmless leftover; app ignores it. You can leave it or delete the meta row manually later.
6. **Something still POSTs `/api/key`** → expect 400 with the migration message (old bookmark/script).

---

## What was *not* rewritten

- Matchup / verdict / postgame grading logic
- SQLite schema (except we stopped writing `api_key` meta)
- Live Client polling shape
- Data Dragon / camps UI
- Rate limiter implementation (still shared via `riot.py`)

---

## Suggested smoke test

1. Restart server with a valid `RIOT_API_KEY`.
2. Setup → Check key status → expect “Server key OK” + green pill.
3. Save Riot ID → Sync a few matches.
4. Live tab (in game or last-game snapshot).
5. Player search for a known ID.
6. Postgame open latest synced game.
7. Confirm browser Network tab never shows `api.riotgames.com` or a raw `RGAPI-` response body from `/api/config`.
