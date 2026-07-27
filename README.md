# LoL Live Helper

**Version:** 0.9.2 (see `VERSION`)

A local League helper with:

- **Desktop launcher** (Electron) — start/stop server, overlay toggles, module switches
- **Free overlay** — always-on-top live stats (hotkeys, click-through)
- **Companion dashboard** — browser at `http://localhost:8000` for Sync, Player, Postgame, Builds, Stats, Setup

Personal matchup win rates come from *your* Match-V5 history (not global stats). Live numbers come from Riot’s Live Client (`:2999`) while you’re in a game. **No Overwolf.**

## Quick start (Windows)

1. One-time setup:

   ```powershell
   python -m venv .venv
   .venv\Scripts\pip.exe install -r requirements.txt
   copy .env.example .env
   # optional: set RIOT_API_KEY, RIOT_REGION, RIOT_PLATFORM in .env

   cd overlay-app
   npm install
   cd ..
   ```

2. **Double-click `lolhelp.cmd`**

   Opens the launcher. It starts the local server and the overlay HUD.

### Overlay hotkeys

| Hotkey | Action |
|--------|--------|
| `Ctrl+Shift+O` | Show / hide overlay |
| `Ctrl+Shift+I` | Play-through ↔ grab (drag / resize / opacity) |

Closing the **launcher** stops the server and overlay.

### Dev (server only)

```powershell
.venv\Scripts\python.exe -m uvicorn app.main:app --port 8000
```

## How it works

- **Live game detection** uses Riot's [Live Client Data API](https://developer.riotgames.com/docs/lol#game-client-api) at `https://127.0.0.1:2999` while in game. No API key needed for live scores / overlay basics.
- **Matchup WR + Sync / Player / Postgame** need a Riot API key (dev keys expire every 24h). Paste in **Setup → Use for this session**, or set `RIOT_API_KEY` in `.env`.

## Code layout

```
lolhelp.cmd             boots Electron launcher
overlay-app/            launcher UI + overlay host (Electron)
overlay_shell.py        legacy pywebview fallback
app/                    FastAPI backend
static/                 companion dashboard + /overlay HUD
```
