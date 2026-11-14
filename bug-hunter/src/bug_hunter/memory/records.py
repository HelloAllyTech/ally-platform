"""Typed long-term memory records, one model per namespace (spec §8).

Every record carries ``created_at``, ``last_used_at`` and ``source_run``; ``text`` is
the one field the semantic index embeds. Text fields are scrubbed by the store on
every write, never here.
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field

Kind = Literal[
    "bugs",
    "false_alarms",
    "wrong_theories",
    "conventions",
    "fragile_areas",
    "run_stats",
]
KINDS: tuple[str, ...] = Kind.__args__  # type: ignore[attr-defined]
PREFIX = {
    "bugs": "bug",
    "false_alarms": "fa",
    "wrong_theories": "wt",
    "conventions": "cv",
    "fragile_areas": "fr",
    "run_stats": "rs",
}


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def new_id(kind: str) -> str:
    return f"{PREFIX[kind]}-{uuid.uuid4().hex[:10]}"


class LineFingerprint(BaseModel):
    """A hash of the code lines a record is about: ``lines`` None = the whole file.
    Only the hash is kept, never the code."""

    model_config = ConfigDict(extra="forbid")

    path: str  # repo-relative
    start: int | None = None
    end: int | None = None
    sha: str  # sha256 of the whitespace-normalised lines; "missing" if absent


class Record(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str
    app: str
    text: str  # what recall shows and the semantic index embeds
    files: list[str] = Field(default_factory=list)
    signature: str = ""  # normalised error/finding signature for exact lookup
    source_run: str = ""
    created_at: str = Field(default_factory=now)
    last_used_at: str | None = None


class BugRecord(Record):
    """A past bug: dedupe at triage, examples for fix. Written by ``learn``."""

    title: str
    root_cause: str = ""
    fix_summary: str = ""
    status: str = ""  # the run's final status
    diagnosis: str | None = None  # human verdict, when given
    fix_verdict: str | None = None
    verdict_reason: str = ""
    fingerprints: list[LineFingerprint] = Field(default_factory=list)
    # the finding as investigate wrote it: reused when a confirmed diagnosis had a
    # fix that was wrong or needed edits (triage skips investigate)
    finding: dict | None = None


class FalseAlarmRecord(Record):
    """A finding a human said is not a bug, and why. Closes a repeat at triage only
    while the fingerprinted lines are unchanged; otherwise it is a hint."""

    title: str
    reason: str
    fingerprints: list[LineFingerprint] = Field(default_factory=list)


class WrongTheoryRecord(Record):
    """A diagnosis a human said was wrong for this kind of report; investigate
    recalls it so the same theory is not repeated."""

    title: str
    theory: str
    reason: str


class ConventionRecord(Record):
    """A rule learned from verdicts. Used in prompts only after a human approves."""

    status: Literal["pending", "approved"] = "pending"
    count: int = 1  # verdicts that raised it
    sources: list[str] = Field(default_factory=list)  # run ids


class FragileAreaRecord(Record):
    """A file whose fixes were wrong or needed edits; raises the risk level."""

    count: int = 1
    reasons: list[str] = Field(default_factory=list)


class RunStatsRecord(Record):
    """Precision per signal source and mode (``global`` app)."""

    key: str  # e.g. "issue/issue" (source/mode)
    diagnoses: int = 0
    diagnosis_correct: int = 0
    not_a_bug: int = 0
    fixes: int = 0
    fix_worked: int = 0
    fix_needed_edits: int = 0


MODELS: dict[str, type[Record]] = {
    "bugs": BugRecord,
    "false_alarms": FalseAlarmRecord,
    "wrong_theories": WrongTheoryRecord,
    "conventions": ConventionRecord,
    "fragile_areas": FragileAreaRecord,
    "run_stats": RunStatsRecord,
}


def kind_of(record_id: str) -> str:
    prefix = record_id.split("-", 1)[0]
    for kind, p in PREFIX.items():
        if p == prefix:
            return kind
    raise ValueError(f"unknown memory id {record_id!r}")
