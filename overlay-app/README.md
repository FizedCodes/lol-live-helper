# LoL Live Helper — desktop shell (Electron)

Launcher window + always-on-top overlay. **Not Overwolf.**

## One-time setup

Needs [Node.js LTS](https://nodejs.org/):

```bat
cd overlay-app
npm install
```

## Run

From repo root (recommended):

```bat
lolhelp.cmd
```

That opens the **launcher**, which starts the FastAPI server and the overlay HUD.

Dev (same thing):

```bat
cd overlay-app
npx electron .
```

## What the launcher does

- Starts / restarts / stops the local server on `:8000`
- Show/hide overlay + play-through toggle
- Module switches (live stats free; rank grind / habits gated for later)
- Opens the companion dashboard in your browser
- **Updates**: check GitHub / pull + restart (skips if you have local edits)
- Hotkeys: `Ctrl+Shift+O`, `Ctrl+Shift+I`

Prefs save to `data/launcher_prefs.json`.
