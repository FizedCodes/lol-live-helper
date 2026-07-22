"""Turns your personal matchup history into a simple in-game call.

Tune the thresholds here: below MIN_GAMES_FOR_VERDICT games the sample is ignored,
and win rates outside the 45-55% band flip the call to play safe / push hard.
"""
from __future__ import annotations

MIN_GAMES_FOR_VERDICT = 3
FAVORED_WR = 55
UNFAVORED_WR = 45


def verdict(matchup: dict, my_overall: dict | None) -> dict:
    best = matchup.get("vs_as_laner") or matchup.get("vs_any")
    if not best or best["games"] < MIN_GAMES_FOR_VERDICT:
        base = my_overall
        if base and base["games"] >= MIN_GAMES_FOR_VERDICT:
            wr = base["win_rate"]
            note = f"Not enough games vs this champ; based on your {base['games']} games on your pick"
        else:
            return {"call": "unknown", "label": "No data yet", "note": "Sync more matches to build history"}
    else:
        wr = best["win_rate"]
        note = f"Based on {best['games']} of your games vs this champion"
    if wr >= FAVORED_WR:
        return {"call": "favored", "label": "Push hard", "note": note}
    if wr <= UNFAVORED_WR:
        return {"call": "unfavored", "label": "Play safe", "note": note}
    return {"call": "even", "label": "Even matchup", "note": note}
