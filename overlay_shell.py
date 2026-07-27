"""Windows overlay shell for lol-live-helper.

Floating always-on-top HUD. Porofessor-style glass/click-through needs a native
game overlay host (Overwolf); we approximate with a small Win32 window + WebView2.

Hotkeys:
  Ctrl+Shift+O  show / hide
  Ctrl+Shift+I  play-through  ↔  grab (drag / resize / opacity slider)

Closing this window does NOT stop uvicorn (lolhelp.cmd stops it for you).
"""
from __future__ import annotations

import ctypes
import json
import os
import sys
import threading
import time
import urllib.error
import urllib.request
from ctypes import wintypes
from pathlib import Path

# Transparent WebView2 surface (ARGB 0). Must be set before WebView2 starts.
os.environ["WEBVIEW2_DEFAULT_BACKGROUND_COLOR"] = "0"

ROOT = Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
GEOM_PATH = DATA_DIR / "overlay_geom.json"
OVERLAY_URL = "http://127.0.0.1:8000/overlay"
LIVE_URL = "http://127.0.0.1:8000/api/live"
WINDOW_TITLE = "LoL Live Helper Overlay"

DEFAULT_W = 360
DEFAULT_H = 340

# Win32
GWL_EXSTYLE = -20
GWL_STYLE = -16
GWLP_WNDPROC = -4
WS_EX_TOOLWINDOW = 0x00000080
WS_EX_NOACTIVATE = 0x08000000
WS_THICKFRAME = 0x00040000
SW_HIDE = 0
SW_SHOWNOACTIVATE = 4
HWND_TOPMOST = -1
SWP_NOMOVE = 0x0002
SWP_NOSIZE = 0x0001
SWP_NOACTIVATE = 0x0010
SWP_SHOWWINDOW = 0x0040
SWP_FRAMECHANGED = 0x0020
MOD_CONTROL = 0x0002
MOD_SHIFT = 0x0004
MOD_NOREPEAT = 0x4000
VK_O = 0x4F
VK_I = 0x49
WM_HOTKEY = 0x0312
WM_NCHITTEST = 0x0084
HTTRANSPARENT = -1
HOTKEY_TOGGLE_VISIBLE = 1
HOTKEY_TOGGLE_CLICK = 2
SM_CXSCREEN = 0

user32 = ctypes.windll.user32
kernel32 = ctypes.windll.kernel32

LRESULT = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(
    LRESULT, wintypes.HWND, ctypes.c_uint, wintypes.WPARAM, wintypes.LPARAM
)

if ctypes.sizeof(ctypes.c_void_p) == 8:
    _get_long = user32.GetWindowLongPtrW
    _set_long = user32.SetWindowLongPtrW
else:
    _get_long = user32.GetWindowLongW
    _set_long = user32.SetWindowLongW

user32.CallWindowProcW.restype = LRESULT
user32.CallWindowProcW.argtypes = [
    ctypes.c_void_p,
    wintypes.HWND,
    ctypes.c_uint,
    wintypes.WPARAM,
    wintypes.LPARAM,
]

# Keep the subclass callback alive for the process lifetime.
_wndproc_ref = None
_old_wndproc = None
_hooked_hwnd = 0


def wait_for_server(timeout_s: float = 45.0) -> bool:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(LIVE_URL, timeout=8) as resp:
                if resp.status == 200:
                    return True
        except (urllib.error.URLError, TimeoutError, OSError):
            pass
        time.sleep(0.4)
    return False


def live_in_game() -> bool:
    try:
        with urllib.request.urlopen(LIVE_URL, timeout=8) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        return bool(data.get("in_game")) and not data.get("error")
    except (urllib.error.URLError, TimeoutError, OSError, json.JSONDecodeError):
        return False


def load_geom() -> dict:
    if not GEOM_PATH.exists():
        return {"x": None, "y": 56, "width": DEFAULT_W, "height": DEFAULT_H}
    try:
        data = json.loads(GEOM_PATH.read_text(encoding="utf-8"))
        w = int(data.get("width") or DEFAULT_W)
        h = int(data.get("height") or DEFAULT_H)
        # Old oversized / broken geom left empty white WebView voids
        if w > 420 or h > 420 or w < 260 or h < 200:
            w, h = DEFAULT_W, DEFAULT_H
            data["x"] = None
        data["width"] = w
        data["height"] = h
        return data
    except (OSError, json.JSONDecodeError, TypeError, ValueError):
        return {"x": None, "y": 56, "width": DEFAULT_W, "height": DEFAULT_H}


def save_geom(window) -> None:
    try:
        DATA_DIR.mkdir(parents=True, exist_ok=True)
        GEOM_PATH.write_text(
            json.dumps({
                "x": window.x,
                "y": window.y,
                "width": window.width,
                "height": window.height,
            }),
            encoding="utf-8",
        )
    except Exception:
        pass


def find_hwnd() -> int:
    return int(user32.FindWindowW(None, WINDOW_TITLE) or 0)


def find_league_hwnd() -> int:
    hwnd = int(user32.FindWindowW("RiotWindowClass", None) or 0)
    if hwnd:
        return hwnd
    return int(user32.FindWindowW(None, "League of Legends (TM) Client") or 0)


def restore_league_focus() -> None:
    our = find_hwnd()
    league = find_league_hwnd()
    if not our or not league:
        return
    fg = int(user32.GetForegroundWindow() or 0)
    if fg != our:
        return

    fg_tid = user32.GetWindowThreadProcessId(fg, None)
    league_tid = user32.GetWindowThreadProcessId(league, None)
    cur_tid = kernel32.GetCurrentThreadId()

    attached_fg = False
    attached_league = False
    try:
        if fg_tid and fg_tid != cur_tid:
            attached_fg = bool(user32.AttachThreadInput(cur_tid, fg_tid, True))
        if league_tid and league_tid != cur_tid and league_tid != fg_tid:
            attached_league = bool(user32.AttachThreadInput(cur_tid, league_tid, True))
        user32.BringWindowToTop(league)
        user32.SetForegroundWindow(league)
    finally:
        if attached_league:
            user32.AttachThreadInput(cur_tid, league_tid, False)
        if attached_fg:
            user32.AttachThreadInput(cur_tid, fg_tid, False)


def _wndproc(hwnd, msg, wparam, lparam):
    """Return HTTRANSPARENT while play-through — skips this window AND children."""
    if msg == WM_NCHITTEST and STATE.click_through:
        return HTTRANSPARENT
    if _old_wndproc:
        return user32.CallWindowProcW(_old_wndproc, hwnd, msg, wparam, lparam)
    return user32.DefWindowProcW(hwnd, msg, wparam, lparam)


def install_hit_test_hook(hwnd: int) -> None:
    """Subclass once. Do NOT stamp WS_EX_TRANSPARENT onto WebView2 children (goes white)."""
    global _wndproc_ref, _old_wndproc, _hooked_hwnd
    if not hwnd:
        return
    if _hooked_hwnd == hwnd and _wndproc_ref is not None:
        return
    _wndproc_ref = WNDPROC(_wndproc)
    prev = _set_long(hwnd, GWLP_WNDPROC, ctypes.cast(_wndproc_ref, ctypes.c_void_p).value)
    _old_wndproc = prev
    _hooked_hwnd = hwnd


def notify_mouse_mode(click_through: bool) -> None:
    if STATE.window is None:
        return
    mode = "through" if click_through else "grab"
    label = "play-through" if click_through else "DRAG / RESIZE"
    js = (
        f'document.documentElement.dataset.mouse="{mode}";'
        f'var el=document.getElementById("mouseMode");if(el)el.textContent="{label}";'
    )
    try:
        STATE.window.evaluate_js(js)
    except Exception:
        pass


def apply_window_chrome(click_through: bool) -> None:
    hwnd = find_hwnd()
    if not hwnd:
        return

    install_hit_test_hook(hwnd)

    # Resize edges only in grab mode
    wstyle = int(_get_long(hwnd, GWL_STYLE) or 0)
    if click_through:
        wstyle &= ~WS_THICKFRAME
    else:
        wstyle |= WS_THICKFRAME
    _set_long(hwnd, GWL_STYLE, wstyle)

    # Never use WS_EX_TRANSPARENT here — with WebView2 it either does nothing
    # or, when forced onto children, blanks the page white.
    style = int(_get_long(hwnd, GWL_EXSTYLE) or 0)
    style |= WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE
    style &= ~0x00000020  # clear WS_EX_TRANSPARENT if something else set it
    _set_long(hwnd, GWL_EXSTYLE, style)

    user32.SetWindowPos(
        hwnd, HWND_TOPMOST, 0, 0, 0, 0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW | SWP_FRAMECHANGED,
    )
    notify_mouse_mode(click_through)


def set_visible(visible: bool) -> None:
    hwnd = find_hwnd()
    if not hwnd:
        return
    if visible:
        user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE)
        user32.SetWindowPos(
            hwnd, HWND_TOPMOST, 0, 0, 0, 0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW,
        )
        restore_league_focus()
    else:
        user32.ShowWindow(hwnd, SW_HIDE)


def patch_pywebview_focus_steal() -> None:
    try:
        from webview.platforms import edgechromium
    except Exception:
        return

    def on_navigation_start(self, sender, args):
        if not self.pywebview_window.transparent:
            return
        try:
            hwnd = int(self.form.Handle.ToInt32())
        except Exception:
            try:
                self.form.Show()
            except Exception:
                pass
            return
        if not user32.ShowWindow(hwnd, SW_SHOWNOACTIVATE):
            try:
                self.form.Show()
            except Exception:
                pass

    edgechromium.EdgeChrome.on_navigation_start = on_navigation_start


class OverlayState:
    def __init__(self):
        self.in_game = False
        self.user_hidden = False
        self.click_through = True
        self.window = None
        self._lock = threading.Lock()

    def desired_visible(self) -> bool:
        # Stay up in lobby so you can place + tune opacity before a game.
        return not self.user_hidden

    def toggle_visible(self) -> None:
        with self._lock:
            if self.desired_visible():
                self.user_hidden = True
                set_visible(False)
            else:
                self.user_hidden = False
                set_visible(True)
                apply_window_chrome(self.click_through)
                restore_league_focus()

    def toggle_click(self) -> None:
        with self._lock:
            self.click_through = not self.click_through
            apply_window_chrome(self.click_through)
            if self.click_through:
                restore_league_focus()
            mode = "GRAB (drag / resize / slider)" if not self.click_through else "play-through"
            print(f"Overlay mouse: {mode}", flush=True)

    def set_in_game(self, in_game: bool) -> None:
        with self._lock:
            was = self.in_game
            if in_game == was:
                return
            self.in_game = in_game
            # Entering a match: bring HUD back if they had hidden it
            if in_game:
                self.user_hidden = False
                set_visible(True)
                apply_window_chrome(self.click_through)
                restore_league_focus()
            # Leaving a match: keep HUD up so you can tweak before next game


STATE = OverlayState()


def hotkey_loop() -> None:
    mods = MOD_CONTROL | MOD_SHIFT | MOD_NOREPEAT
    ok_o = user32.RegisterHotKey(None, HOTKEY_TOGGLE_VISIBLE, mods, VK_O)
    ok_i = user32.RegisterHotKey(None, HOTKEY_TOGGLE_CLICK, mods, VK_I)
    if not ok_o:
        print("Warning: could not register Ctrl+Shift+O (maybe in use).")
    if not ok_i:
        print("Warning: could not register Ctrl+Shift+I (maybe in use).")
    if not ok_o or not ok_i:
        print(
            "If League is running as Administrator, restart the overlay as Admin "
            "too — Windows blocks hotkeys from a non-elevated app."
        )

    msg = wintypes.MSG()
    while user32.GetMessageW(ctypes.byref(msg), None, 0, 0) != 0:
        if msg.message == WM_HOTKEY:
            if msg.wParam == HOTKEY_TOGGLE_VISIBLE:
                STATE.toggle_visible()
            elif msg.wParam == HOTKEY_TOGGLE_CLICK:
                STATE.toggle_click()
        user32.TranslateMessage(ctypes.byref(msg))
        user32.DispatchMessageW(ctypes.byref(msg))

    user32.UnregisterHotKey(None, HOTKEY_TOGGLE_VISIBLE)
    user32.UnregisterHotKey(None, HOTKEY_TOGGLE_CLICK)


def game_watch_loop() -> None:
    """Track in-game for focus restore only — HUD stays visible in lobby."""
    while True:
        try:
            STATE.set_in_game(live_in_game())
        except Exception:
            pass
        time.sleep(0.5)


def focus_watch_loop() -> None:
    while True:
        try:
            if STATE.in_game and not STATE.user_hidden and STATE.click_through:
                restore_league_focus()
        except Exception:
            pass
        time.sleep(0.25)


def on_loaded() -> None:
    def _apply():
        for _ in range(40):
            if find_hwnd():
                apply_window_chrome(True)
                STATE.set_in_game(live_in_game())
                set_visible(True)
                return
            time.sleep(0.1)

    threading.Thread(target=_apply, daemon=True).start()


def on_closing() -> None:
    if STATE.window is not None:
        save_geom(STATE.window)


def main() -> int:
    try:
        import webview
    except ImportError:
        print("Missing pywebview. From the project folder run:")
        print("  .venv\\Scripts\\pip.exe install -r requirements.txt")
        return 1

    patch_pywebview_focus_steal()

    if not wait_for_server():
        print("Server at http://127.0.0.1:8000 did not start in time.")
        print("Start it with lolhelp.cmd or: .venv\\Scripts\\python.exe -m uvicorn app.main:app --port 8000")
        return 1

    geom = load_geom()
    width = int(geom.get("width") or DEFAULT_W)
    height = int(geom.get("height") or DEFAULT_H)
    x = geom.get("x")
    y = geom.get("y")
    if x is None:
        x = max(40, int(user32.GetSystemMetrics(SM_CXSCREEN)) - width - 28)
    if y is None:
        y = 56

    STATE.window = webview.create_window(
        WINDOW_TITLE,
        OVERLAY_URL,
        width=width,
        height=height,
        x=int(x),
        y=int(y),
        on_top=True,
        frameless=True,
        easy_drag=True,
        transparent=True,
        shadow=False,
        background_color="#000000",
        resizable=True,
        min_size=(280, 220),
        focus=False,
    )
    STATE.window.events.loaded += on_loaded
    STATE.window.events.closing += on_closing

    threading.Thread(target=hotkey_loop, daemon=True).start()
    threading.Thread(target=game_watch_loop, daemon=True).start()
    threading.Thread(target=focus_watch_loop, daemon=True).start()

    print("Floating HUD overlay.")
    print("  Ctrl+Shift+O  show/hide (stays up out of game for editing)")
    print("  Ctrl+Shift+I  play-through (clicks go to League)  ↔  grab (gold outline)")
    print("  Note: Prefer Electron host via lolhelp.cmd when overlay-app is installed.")
    webview.start()
    return 0


if __name__ == "__main__":
    sys.exit(main())
