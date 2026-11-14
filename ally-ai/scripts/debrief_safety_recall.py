"""Recall gate for the debrief Safety reader, on the seeded safety set
(`app/core/debrief/safety_recall.py`): every planted cue on every repetition.

Run from the ally-ai project so the .env loads:

    poetry run python scripts/debrief_safety_recall.py [--reps 3] [--model <id>]

`--model` gates a candidate (a backup or a swap) before a release names it;
without it the reader's configured model is used. The PM agent's gate runs the
same set through `POST /debrief/safety-recall`.

Exits 1 if recall is below 100% on any repetition.
"""

from __future__ import annotations

import argparse
import asyncio
import sys

from app.core.debrief.safety_recall import run_recall


async def main(reps: int, model=None) -> int:
    result = await run_recall(reps, model)
    for r in result["reps"]:
        print(
            f"rep {r['rep']}: recall {r['recall']:.0%} ({r['found']}/{r['planted']}), "
            f"false alarms {r['false_alarms']}"
        )
        for m in r["missed"]:
            print(f"  MISSED  {m}")
    print("PASS" if result["passed"] else "FAIL")
    return 0 if result["passed"] else 1


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--reps", type=int, default=3)
    parser.add_argument("--model", default=None)
    a = parser.parse_args()
    sys.exit(asyncio.run(main(a.reps, a.model)))
