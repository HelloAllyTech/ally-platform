"""Daily model-spend ledger: ``~/.bug-hunter/spend.json`` on a laptop, or the
``bughunter.spend`` table (``BUGHUNTER_SPEND_BACKEND=db``, chunk 08) so the daily
service on the VM and every machine that records spend share one ledger.

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
from typing import Protocol, Union
from zoneinfo import ZoneInfo

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


ENV_BACKEND = "BUGHUNTER_SPEND_BACKEND"  # file (default) | db


class Ledger(Protocol):
    def entries(self) -> list[Entry]: ...

    def append(self, entry: Entry) -> None: ...


class FileLedger:
    def __init__(self, path: Path = SPEND_FILE):
        self.path = path

    def entries(self) -> list[Entry]:
        if not self.path.exists():
            return []
        data = json.loads(self.path.read_text(encoding="utf-8"))
        return [Entry(**e) for e in data.get("entries", [])]

    def append(self, entry: Entry) -> None:
        rows = self.entries() + [entry]
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(
            json.dumps(
                {"entries": [asdict(e) for e in rows], "daily_cap_usd": DAILY_CAP_USD},
                indent=1,
            ),
            encoding="utf-8",
        )


class PostgresLedger:
    """Rows in ``bughunter.spend`` (``bug-hunter db migrate`` creates the table)."""

    def __init__(self, url: str):
        self.url = url

    def _conn(self):
        from psycopg import Connection

        return Connection.connect(self.url, autocommit=True)

    def entries(self) -> list[Entry]:
        with self._conn() as conn:
            rows = conn.execute(
                "SELECT at, usd, source, note FROM bughunter.spend ORDER BY at, id"
            ).fetchall()
        out = []
        for at, usd, source, note in rows:
            iso = at.astimezone(timezone.utc).isoformat(timespec="seconds")
            out.append(Entry(iso, day_of(iso), float(usd), source, note or ""))
        return out

    def append(self, entry: Entry) -> None:
        with self._conn() as conn:
            conn.execute(
                "INSERT INTO bughunter.spend (at, usd, source, note) "
                "VALUES (%s, %s, %s, %s)",
                (entry.at, entry.usd, entry.source, entry.note),
            )


Where = Union[Path, Ledger]


def ledger(where: Where = SPEND_FILE) -> Ledger:
    """A ledger object, a file path, or the default: the database when
    ``BUGHUNTER_SPEND_BACKEND=db``, else ``SPEND_FILE``."""
    if not isinstance(where, Path):
        return where
    if where == SPEND_FILE and os.environ.get(ENV_BACKEND) == "db":
        from bug_hunter.graph.checkpointer import db_url

        return PostgresLedger(db_url())
    return FileLedger(where)


def _load(path: Where = SPEND_FILE) -> list[Entry]:
    return ledger(path).entries()


# The ledger's day rolls over at midnight in this zone (IST by default), not UTC.
ENV_TZ = "BUGHUNTER_SPEND_TZ"


def ledger_tz() -> ZoneInfo:
    return ZoneInfo(os.environ.get(ENV_TZ) or "Asia/Kolkata")


def day_of(at: str) -> str:
    """The ledger day of a UTC timestamp, in the ledger's zone."""
    return datetime.fromisoformat(at).astimezone(ledger_tz()).date().isoformat()


def today() -> str:
    return datetime.now(ledger_tz()).date().isoformat()


def record(usd: float, source: str, note: str = "", path: Where = SPEND_FILE) -> Entry:
    now = datetime.now(timezone.utc)
    entry = Entry(
        at=now.isoformat(timespec="seconds"),
        day=day_of(now.isoformat()),
        usd=round(float(usd), 4),
        source=source,
        note=note,
    )
    ledger(path).append(entry)
    return entry


def total_for(day: str | None = None, path: Where = SPEND_FILE) -> float:
    day = day or today()
    return round(sum(e.usd for e in _load(path) if day_of(e.at) == day), 4)


def summary(day: str | None = None, path: Where = SPEND_FILE) -> str:
    day = day or today()
    rows = [e for e in _load(path) if day_of(e.at) == day]
    total = round(sum(e.usd for e in rows), 4)
    lines = [
        f"spend {day} ({ledger_tz().key}): ${total:.2f} "
        f"of the ${DAILY_CAP_USD:.0f} daily cap"
    ]
    for e in rows:
        lines.append(f"  {e.at[11:16]}  ${e.usd:6.2f}  {e.source:<11} {e.note}")
    return "\n".join(lines)


def check_cap(
    expected_usd: float = 0.0,
    override: bool | None = None,
    cap: float = DAILY_CAP_USD,
    path: Where = SPEND_FILE,
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
