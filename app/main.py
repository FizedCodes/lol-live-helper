"""lol-live-helper: local dashboard showing live-game matchup context from your own match history.

Wiring only — the real logic lives in:
  routes_config.py  Riot ID settings + key status
  routes_riot.py    thin /api/riot/* wrappers around the Riot service
  routes_sync.py    match history sync + aggregate stats
  routes_live.py    the live game view
  routes_player.py  one-click / searchable player lookup
  routes_postgame.py after-match report
  analysis.py       play safe / push hard verdict rules
  ranks.py          League-V4 rank lookups (cached)
  postgame.py       grades, opponent compare, item buy order
  riot.py           low-level HTTP clients for Riot's APIs
  riot_service.py   centralized server-side Riot API entry point
  store.py          SQLite persistence
  config.py         settings (session key in memory + env RIOT_API_KEY)
"""
from __future__ import annotations

from pathlib import Path

from dotenv import load_dotenv
from fastapi import FastAPI
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles

from app import routes_config, routes_live, routes_player, routes_postgame, routes_riot, routes_sync

load_dotenv()

app = FastAPI(title="lol-live-helper")

STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@app.get("/")
async def index():
    return FileResponse(STATIC_DIR / "index.html")


@app.get("/overlay")
async def overlay():
    """Free one-monitor live-stats HUD (opened by overlay_shell.py)."""
    return FileResponse(STATIC_DIR / "overlay.html")


app.include_router(routes_config.router)
app.include_router(routes_sync.router)
app.include_router(routes_live.router)
app.include_router(routes_player.router)
app.include_router(routes_postgame.router)
app.include_router(routes_riot.router)
app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")
