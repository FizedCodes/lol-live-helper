"""Launcher helpers for lolhelp.cmd / Electron — stop old builds, wait for server.

Process killing is done in Python on purpose. An earlier PowerShell Where-Object
put `-or` on its own line after a closed `(...)`, which PowerShell treats as a
*new command* — the filter then matched every process and Stop-Process wiped
the session. Keep matching logic here; never reintroduce PS boolean filters.
"""
from __future__ import annotations

import os
import subprocess
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

PORT = 8000
LIVE_URL = f"http://127.0.0.1:{PORT}/api/live"
OVERLAY_URL = f"http://127.0.0.1:{PORT}/overlay"
WAIT_HTTP_TIMEOUT_S = 8.0
WAIT_TRIES = 40
WAIT_DELAY = 0.5

ROOT = Path(__file__).resolve().parent
# Narrow Electron match: our overlay-app folder only (not the whole repo name).
OVERLAY_APP_MARK = str((ROOT / "overlay-app").resolve()).lower()


def _protected_pids() -> set[int]:
    """Never kill ourselves, our parent, or (when nested) the Electron host."""
    pids = {os.getpid()}
    try:
        ppid = os.getppid()
        if ppid:
            pids.add(int(ppid))
    except Exception:
        pass
    # Optional: caller can pass --except-pid 1234 5678
    args = sys.argv[2:]
    i = 0
    while i < len(args):
        if args[i] == "--except-pid" and i + 1 < len(args):
            try:
                pids.add(int(args[i + 1]))
            except ValueError:
                pass
            i += 2
            continue
        i += 1
    return pids


def _run_ps_stdout(script: str) -> str:
    """Run a tiny PowerShell snippet and return stdout (no kill logic here)."""
    try:
        completed = subprocess.run(
            [
                "powershell",
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                script,
            ],
            check=False,
            capture_output=True,
            text=True,
            timeout=30,
        )
    except (OSError, subprocess.TimeoutExpired):
        return ""
    return completed.stdout or ""


def _pids_listening_on_port(port: int) -> set[int]:
    # One PID per line — no Where-Object boolean logic.
    out = _run_ps_stdout(
        f"Get-NetTCPConnection -LocalPort {port} -State Listen "
        f"-ErrorAction SilentlyContinue | "
        f"ForEach-Object {{ $_.OwningProcess }} | "
        f"Sort-Object -Unique"
    )
    pids: set[int] = set()
    for line in out.splitlines():
        line = line.strip()
        if line.isdigit():
            pids.add(int(line))
    return pids


def _iter_process_rows(*, names: tuple[str, ...]) -> list[tuple[int, str, str]]:
    """Return (pid, name, commandline) for specific exe names only."""
    if not names:
        return []
    # Filter in CIM — listing every process on the machine is slow and unnecessary.
    name_filter = " OR ".join(f"Name='{n}'" for n in names)
    out = _run_ps_stdout(
        f"Get-CimInstance Win32_Process -Filter \"{name_filter}\" "
        f"-ErrorAction SilentlyContinue | "
        "ForEach-Object { "
        "  $cmd = if ($_.CommandLine) { $_.CommandLine } else { '' }; "
        "  ($_.ProcessId.ToString() + [char]31 + $_.Name + [char]31 + $cmd) "
        "}"
    )
    rows: list[tuple[int, str, str]] = []
    for line in out.splitlines():
        parts = line.split("\x1f", 2)
        if len(parts) < 2:
            continue
        try:
            pid = int(parts[0])
        except ValueError:
            continue
        name = parts[1] or ""
        cmd = parts[2] if len(parts) > 2 else ""
        rows.append((pid, name, cmd))
    return rows


def _is_our_python(name: str, cmd: str) -> bool:
    n = name.lower()
    if n not in ("python.exe", "pythonw.exe"):
        return False
    c = cmd.lower()
    if "overlay_shell.py" in c:
        return True
    if "uvicorn" in c and "app.main" in c:
        return True
    return False


def _is_our_electron(name: str, cmd: str) -> bool:
    if name.lower() != "electron.exe":
        return False
    c = cmd.lower()
    # Require our overlay-app path — never a broad repo-name glob.
    return OVERLAY_APP_MARK in c.replace("/", "\\")


def _collect_targets(*, kill_electron: bool) -> set[int]:
    protect = _protected_pids()
    targets: set[int] = set()

    for pid in _pids_listening_on_port(PORT):
        if pid and pid not in protect:
            targets.add(pid)

    names = ["python.exe", "pythonw.exe"]
    if kill_electron:
        names.append("electron.exe")
    for pid, name, cmd in _iter_process_rows(names=tuple(names)):
        if not pid or pid in protect:
            continue
        if _is_our_python(name, cmd):
            targets.add(pid)
            continue
        if kill_electron and _is_our_electron(name, cmd):
            targets.add(pid)

    # Never touch kernel / idle / system essentials even if something went wrong.
    targets -= {0, 4}
    return targets


def _kill_pids(pids: set[int]) -> None:
    for pid in sorted(pids):
        try:
            subprocess.run(
                ["taskkill", "/PID", str(pid), "/F"],
                check=False,
                capture_output=True,
                text=True,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass


def stop_server_only() -> None:
    """Free :8000 + uvicorn/overlay_shell python — do NOT touch Electron."""
    _kill_pids(_collect_targets(kill_electron=False))
    time.sleep(0.35)


def stop_old(*, kill_electron: bool = True) -> None:
    """Kill server (+ optional leftover Electron from a previous run)."""
    _kill_pids(_collect_targets(kill_electron=kill_electron))
    time.sleep(0.35)


def wait_ready() -> int:
    for i in range(1, WAIT_TRIES + 1):
        try:
            with urllib.request.urlopen(LIVE_URL, timeout=WAIT_HTTP_TIMEOUT_S) as resp:
                if resp.status == 200:
                    print(f"Server ready ({i} check{'s' if i != 1 else ''}).")
                    return 0
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"  … waiting ({i}/{WAIT_TRIES}): {type(e).__name__}")
        time.sleep(WAIT_DELAY)
    return 1


def check_overlay_route() -> int:
    try:
        with urllib.request.urlopen(OVERLAY_URL, timeout=2) as resp:
            return 0 if resp.status == 200 else 1
    except (urllib.error.URLError, TimeoutError, OSError):
        return 1


def main(argv: list[str]) -> int:
    cmd = (argv[1] if len(argv) > 1 else "wait").lower()
    if cmd == "stop":
        print(f"Stopping old LoL Live Helper on port {PORT} (if any)...")
        targets = _collect_targets(kill_electron=True)
        if targets:
            print(f"  ending {len(targets)} process(es): {', '.join(str(p) for p in sorted(targets))}")
        else:
            print("  nothing to stop.")
        _kill_pids(targets)
        time.sleep(0.35)
        return 0
    if cmd == "stop-server":
        # Used by the running Electron launcher — must not kill Electron.
        stop_server_only()
        return 0
    if cmd == "overlay-ok":
        return check_overlay_route()
    if cmd == "wait":
        return wait_ready()
    if cmd == "dry-run":
        # Safety check: list what stop would kill, without killing.
        targets = _collect_targets(kill_electron=True)
        rows = {
            pid: (name, cmd)
            for pid, name, cmd in _iter_process_rows(
                names=("python.exe", "pythonw.exe", "electron.exe")
            )
        }
        print(f"dry-run would stop {len(targets)} process(es):")
        for pid in sorted(targets):
            name, cmd = rows.get(pid, ("?", ""))
            print(f"  PID {pid}  {name}")
            if cmd:
                print(f"    {cmd[:180]}")
        return 0
    print(f"Unknown command: {cmd} (use stop | stop-server | wait | overlay-ok | dry-run)")
    return 2


if __name__ == "__main__":
    sys.exit(main(sys.argv))
