"""Human verdicts on a run (chunk 07): ``bughunter.verdicts`` behind an interface.

A verdict has two parts and a reason: the diagnosis (``correct | wrong | not_a_bug``)
and the fix (``worked | needed_edits | wrong | none``). The CLI writes them now; the
admin dashboard writes the same table in chunk 09.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Literal, Protocol, get_args

Diagnosis = Literal["correct", "wrong", "not_a_bug"]
FixVerdict = Literal["worked", "needed_edits", "wrong", "none"]
DIAGNOSES: tuple[str, ...] = get_args(Diagnosis)
FIX_VERDICTS: tuple[str, ...] = get_args(FixVerdict)


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


@dataclass
class Verdict:
    run_id: str
    app: str
    diagnosis: str
    fix: str
    reason: str
    decided_by: str
    source: str = "cli"
    id: int | None = None
    created_at: str = field(default_factory=_now)
    applied_at: str | None = None

    def __post_init__(self) -> None:
        if self.diagnosis not in DIAGNOSES:
            raise ValueError(f"diagnosis must be one of {', '.join(DIAGNOSES)}")
        if self.fix not in FIX_VERDICTS:
            raise ValueError(f"fix must be one of {', '.join(FIX_VERDICTS)}")
        if not self.reason.strip():
            raise ValueError("a verdict needs a reason")
        if self.diagnosis == "not_a_bug" and self.fix not in ("none", "wrong"):
            raise ValueError("not_a_bug goes with fix none (or wrong, if one was made)")


class VerdictStore(Protocol):
    def add(self, verdict: Verdict) -> Verdict: ...

    def unapplied(self) -> list[Verdict]: ...

    def mark_applied(self, verdict_id: int) -> None: ...

    def for_run(self, run_id: str) -> list[Verdict]: ...


class InMemoryVerdicts:
    def __init__(self) -> None:
        self.rows: list[Verdict] = []

    def add(self, verdict: Verdict) -> Verdict:
        verdict.id = len(self.rows) + 1
        self.rows.append(verdict)
        return verdict

    def unapplied(self) -> list[Verdict]:
        return [v for v in self.rows if v.applied_at is None]

    def mark_applied(self, verdict_id: int) -> None:
        for v in self.rows:
            if v.id == verdict_id:
                v.applied_at = _now()

    def for_run(self, run_id: str) -> list[Verdict]:
        return [v for v in self.rows if v.run_id == run_id]


class PostgresVerdicts:
    """Rows in ``bughunter.verdicts`` (``bug-hunter db migrate`` creates the table)."""

    COLUMNS = ("run_id", "app", "diagnosis", "fix", "reason", "decided_by", "source")

    def __init__(self, url: str):
        from psycopg import Connection
        from psycopg.rows import dict_row

        self.conn = Connection.connect(url, autocommit=True, row_factory=dict_row)

    def _row(self, row: dict) -> Verdict:
        row = dict(row)
        for key in ("created_at", "applied_at"):
            if row.get(key) is not None and not isinstance(row[key], str):
                row[key] = row[key].isoformat(timespec="seconds")
        return Verdict(**{k: row[k] for k in Verdict.__dataclass_fields__})

    def add(self, verdict: Verdict) -> Verdict:
        row = self.conn.execute(
            f"""INSERT INTO bughunter.verdicts ({', '.join(self.COLUMNS)})
               VALUES ({', '.join('%s' for _ in self.COLUMNS)}) RETURNING *""",
            tuple(getattr(verdict, c) for c in self.COLUMNS),
        ).fetchone()
        return self._row(row)

    def unapplied(self) -> list[Verdict]:
        rows = self.conn.execute(
            "SELECT * FROM bughunter.verdicts WHERE applied_at IS NULL ORDER BY id"
        ).fetchall()
        return [self._row(r) for r in rows]

    def mark_applied(self, verdict_id: int) -> None:
        self.conn.execute(
            "UPDATE bughunter.verdicts SET applied_at = now() WHERE id = %s",
            (verdict_id,),
        )

    def for_run(self, run_id: str) -> list[Verdict]:
        rows = self.conn.execute(
            "SELECT * FROM bughunter.verdicts WHERE run_id = %s ORDER BY id", (run_id,)
        ).fetchall()
        return [self._row(r) for r in rows]
