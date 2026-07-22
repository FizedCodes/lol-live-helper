# AGENTS.md

## Cursor Cloud specific instructions

### What this is
A single local service: a FastAPI + SQLite backend (`app/`) serving a plain HTML/CSS/JS frontend (`static/`, no build step). It shows League of Legends live-game matchup context. See `README.md` and `.cursorrules/Architeture.md` for the full picture.

### Environment
- Python deps live in a virtualenv at `.venv` (gitignored). The startup update script recreates/refreshes it, so use `.venv/bin/python` and `.venv/bin/uvicorn` directly (no need to `activate`).
- There is no configured linter or formatter (only runtime deps in `requirements.txt`). For a quick sanity check use `.venv/bin/python -m py_compile app/*.py tests/*.py`.

### Run / test / build
- Run (dev, hot reload): `.venv/bin/uvicorn app.main:app --port 8000 --reload` then open http://localhost:8000
- Test: `.venv/bin/python -m unittest discover -s tests -v` (pure-SQLite unit tests, no network needed)
- Build: none — the frontend is static and served directly.

### Non-obvious gotchas
- Two features require external things this VM does NOT have, so they cannot be exercised end-to-end here:
  - Match history sync, Riot ID save, and rank lookups need a **Riot dev API key** (`RGAPI-...`, expires every 24h). Set it via the Setup panel (stored in SQLite `meta`, wins over `.env`) or `RIOT_API_KEY` in `.env`.
  - The live in-game view calls the League client's Live Client Data API at `https://127.0.0.1:2999`, which only responds while an actual LoL game is running. Without it, `/api/live` correctly returns `{"in_game": false}`.
- The offline core (SQLite persistence + personal matchup aggregation in `app/store.py`) is fully testable without any key: seed via `store.record_match(...)` and read back through `/api/stats`.
- Data lives in `data/helper.db` (SQLite, gitignored). Delete the `data/` dir to start fresh; the schema is recreated on the next request via `store.connect()`.
