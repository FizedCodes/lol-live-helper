"""Wait until the local dashboard answers on :8000. Exit 0 on success, 1 on timeout."""
from __future__ import annotations

import sys
import time
import urllib.error
import urllib.request

URL = "http://127.0.0.1:8000/api/health"
# Health does not probe Live Client :2999, so a short timeout is enough.
TIMEOUT_S = 2.0
TRIES = 40
DELAY = 0.5


def main() -> int:
    for i in range(1, TRIES + 1):
        try:
            with urllib.request.urlopen(URL, timeout=TIMEOUT_S) as resp:
                if resp.status == 200:
                    print(f"Server ready ({i} check{'s' if i != 1 else ''}).")
                    return 0
        except (urllib.error.URLError, TimeoutError, OSError) as e:
            print(f"  … waiting ({i}/{TRIES}): {type(e).__name__}")
        time.sleep(DELAY)
    return 1


if __name__ == "__main__":
    sys.exit(main())
