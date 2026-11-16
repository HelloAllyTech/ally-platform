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
    report_id: int | None = None  # the dashboard report it judges
    superseded_by: int | None = None  # amended: the verdict that replaced this one
    superseded_at: str | None = None
    retracted_at: str | None = None  # its memory records were removed

    @property
    def active(self) -> bool:
        return self.superseded_by is None

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
    def add(self, verdict: Verdict) -> Verdict:
        """Store it as the active verdict; an earlier active verdict on the same
        report (or run) is superseded, never deleted."""
        ...

    def unapplied(self) -> list[Verdict]: ...

    def mark_applied(self, verdict_id: int) -> None: ...

    def for_run(self, run_id: str) -> list[Verdict]: ...

    def superseded_by(self, verdict_id: int) -> list[Verdict]:
        """The verdicts this one replaced."""
        ...

    def mark_retracted(self, verdict_id: int) -> None: ...


def _same_subject(a: Verdict, b: Verdict) -> bool:
    if a.report_id is not None or b.report_id is not None:
        return a.report_id == b.report_id
    return a.run_id == b.run_id


class InMemoryVerdicts:
    def __init__(self) -> None:
        self.rows: list[Verdict] = []

    def add(self, verdict: Verdict) -> Verdict:
        verdict.id = len(self.rows) + 1
        for old in self.rows:
            if old.active and _same_subject(old, verdict):
                old.superseded_by, old.superseded_at = verdict.id, _now()
        self.rows.append(verdict)
        return verdict

    def unapplied(self) -> list[Verdict]:
        return [v for v in self.rows if v.applied_at is None and v.active]

    def superseded_by(self, verdict_id: int) -> list[Verdict]:
        return [v for v in self.rows if v.superseded_by == verdict_id]

    def mark_retracted(self, verdict_id: int) -> None:
        for v in self.rows:
            if v.id == verdict_id:
                v.retracted_at = _now()

    def mark_applied(self, verdict_id: int) -> None:
        for v in self.rows:
            if v.id == verdict_id:
                v.applied_at = _now()

    def for_run(self, run_id: str) -> list[Verdict]:
        return [v for v in self.rows if v.run_id == run_id]


class PostgresVerdicts:
    """Rows in ``bughunter.verdicts`` (``bug-hunter db migrate`` creates the table)."""

    COLUMNS = (
        "run_id",
        "app",
        "diagnosis",
        "fix",
        "reason",
        "decided_by",
        "source",
        "report_id",
    )

    def __init__(self, url: str):
        from psycopg import Connection
        from psycopg.rows import dict_row

        self.conn = Connection.connect(url, autocommit=True, row_factory=dict_row)

    def _row(self, row: dict) -> Verdict:
        row = dict(row)
        for key in ("created_at", "applied_at", "superseded_at", "retracted_at"):
            if row.get(key) is not None and not isinstance(row[key], str):
                row[key] = row[key].isoformat(timespec="seconds")
        return Verdict(**{k: row[k] for k in Verdict.__dataclass_fields__})

    def add(self, verdict: Verdict) -> Verdict:
        with self.conn.transaction():
            if verdict.report_id is not None:
                match, arg = "report_id = %s", verdict.report_id
            else:
                match, arg = "report_id IS NULL AND run_id = %s", verdict.run_id
            old = self.conn.execute(
                f"""SELECT id FROM bughunter.verdicts
                    WHERE {match} AND superseded_by IS NULL FOR UPDATE""",
                (arg,),
            ).fetchall()
            # the old row stops being active before the new one is inserted, so the
            # one-active-per-report index never sees two
            self.conn.execute(
                "UPDATE bughunter.verdicts SET superseded_by = -1 WHERE id = ANY(%s)",
                ([r["id"] for r in old],),
            )
            row = self.conn.execute(
                f"""INSERT INTO bughunter.verdicts ({', '.join(self.COLUMNS)})
                   VALUES ({', '.join('%s' for _ in self.COLUMNS)}) RETURNING *""",
                tuple(getattr(verdict, c) for c in self.COLUMNS),
            ).fetchone()
            self.conn.execute(
                """UPDATE bughunter.verdicts
                   SET superseded_by = %s, superseded_at = now()
                   WHERE id = ANY(%s)""",
                (row["id"], [r["id"] for r in old]),
            )
        return self._row(row)

    def unapplied(self) -> list[Verdict]:
        rows = self.conn.execute(
            """SELECT * FROM bughunter.verdicts
               WHERE applied_at IS NULL AND superseded_by IS NULL ORDER BY id"""
        ).fetchall()
        return [self._row(r) for r in rows]

    def superseded_by(self, verdict_id: int) -> list[Verdict]:
        rows = self.conn.execute(
            "SELECT * FROM bughunter.verdicts WHERE superseded_by = %s ORDER BY id",
            (verdict_id,),
        ).fetchall()
        return [self._row(r) for r in rows]

    def mark_retracted(self, verdict_id: int) -> None:
        self.conn.execute(
            "UPDATE bughunter.verdicts SET retracted_at = now() WHERE id = %s",
            (verdict_id,),
        )

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
