"""Daily model-spend ledger: ``runs/spend.json`` (gitignored, local machine).

Every eval run and every ``bug-hunter run`` records what it cost; GitHub runs are
recorded here by whoever dispatches them (expected cost at dispatch, actual when the
report is downloaded). ``check_cap`` refuses to start a run once today's total passes
the cap unless the caller overrides explicitly.
"""

from __future__ import annotations

import json
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from pathlib import Path

from bug_hunter.config import RUNS_DIR

SPEND_FILE = RUNS_DIR / "spend.json"
DAILY_CAP_USD = 15.0
ENV_OVERRIDE = "BUGHUNTER_SPEND_OVERRIDE"


class SpendCapExceeded(RuntimeError):
    pass


@dataclass
class Entry:
    at: str  # ISO 8601 UTC
    day: str  # YYYY-MM-DD UTC
    usd: float
    source: str  # local-eval | local-run | github | estimate
    note: str = ""


def _load(path: Path = SPEND_FILE) -> list[Entry]:
    if not path.exists():
        return []
    data = json.loads(path.read_text(encoding="utf-8"))
    return [Entry(**e) for e in data.get("entries", [])]


def _save(entries: list[Entry], path: Path = SPEND_FILE) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {"entries": [asdict(e) for e in entries], "daily_cap_usd": DAILY_CAP_USD},
            indent=1,
        ),
        encoding="utf-8",
    )


def today() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def record(usd: float, source: str, note: str = "", path: Path = SPEND_FILE) -> Entry:
    now = datetime.now(timezone.utc)
    entry = Entry(
        at=now.isoformat(timespec="seconds"),
        day=now.date().isoformat(),
        usd=round(float(usd), 4),
        source=source,
        note=note,
    )
    entries = _load(path)
    entries.append(entry)
    _save(entries, path)
    return entry


def total_for(day: str | None = None, path: Path = SPEND_FILE) -> float:
    day = day or today()
    return round(sum(e.usd for e in _load(path) if e.day == day), 4)


def summary(day: str | None = None, path: Path = SPEND_FILE) -> str:
    day = day or today()
    rows = [e for e in _load(path) if e.day == day]
    lines = [
        f"spend {day}: ${total_for(day, path):.2f} "
        f"of the ${DAILY_CAP_USD:.0f} daily cap"
    ]
    for e in rows:
        lines.append(f"  {e.at[11:16]}  ${e.usd:6.2f}  {e.source:<11} {e.note}")
    return "\n".join(lines)


def check_cap(
    expected_usd: float = 0.0,
    override: bool | None = None,
    cap: float = DAILY_CAP_USD,
    path: Path = SPEND_FILE,
) -> float:
    """Today's total so far. Raises ``SpendCapExceeded`` when today's total (plus the
    expected cost of what is about to start) passes the cap and no override is given
    (``override=True`` or ``BUGHUNTER_SPEND_OVERRIDE=1``)."""
    spent = total_for(path=path)
    if override is None:
        override = os.environ.get(ENV_OVERRIDE, "") in ("1", "true", "yes")
    if spent + expected_usd > cap and not override:
        raise SpendCapExceeded(
            f"today's model spend is ${spent:.2f}; "
            f"starting this (~${expected_usd:.2f}) "
            f"would pass the ${cap:.0f} daily cap. Set {ENV_OVERRIDE}=1 (or "
            f"--override-spend-cap) only with the user's explicit go-ahead."
        )
    return spent
