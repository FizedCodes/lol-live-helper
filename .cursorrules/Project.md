# LoL Live Helper — Project Overview

## What this is
A **local web dashboard** (Windows, opened in a browser at `http://localhost:8000`) that helps the user improve at League of Legends by showing **live matchup context while in game**:

- For every enemy champion: the user's personal win rate against them (overall, as direct lane opponent, and on the champ currently being played).
- A simple verdict per enemy: **Push hard** (favored), **Even**, or **Play safe** (unfavored).
- Live kill score, K/D/A, CS, and ranks for all 10 players.
- When not in game: a replay of the last game's final state + synced stats summary.

## Key design decisions
- **Personal stats, not global**: Riot's API doesn't publish global matchup win rates, so all win rates come from the user's own synced match history (Match-V5). This was a deliberate choice — it reflects how *this player* does into each champion.
- **Two data sources**: the Live Client Data API (`https://127.0.0.1:2999`, no key needed, only works in game) for live state, and the Riot web API (needs key) for history/ranks.
- **No build step**: plain HTML/CSS/JS frontend with ES modules; FastAPI + SQLite backend. Keep it that way unless the user asks.

## Running it
```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```
Dependencies are already installed in `.venv`. Data lives in `data/helper.db` (SQLite, gitignored).

## Gotchas an agent must know
- **Riot dev API keys expire every 24h.** Most "nothing works" reports trace back to this. The key can be updated from the site's Setup panel (stored in DB meta, wins over `.env`). Header pill shows key status.
- `RIOT_REGION` (americas/europe/asia/sea) routes Match-V5/Account-V1; `RIOT_PLATFORM` (na1, euw1, ...) routes League-V4 ranks. Both in `.env`.
- Dev key rate limit: 100 requests / 2 min — sync sleeps and retries on 429.
- The user is a League player, newer to programming — explain changes clearly, avoid jargon.
- The user's own TODO list is in `.cursorrules/TODO.md` — **do not edit it**, it's theirs.
- Keep `Changelogs.MD` updated when features are added.
