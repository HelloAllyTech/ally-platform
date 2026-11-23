"""``bughunter.bugs`` (one row per bug, any source) and ``bughunter.settings`` (the
mode), behind interfaces tests can fake.

Lifecycle: backlog -> queued -> running -> needs_you | failed | done.

- **backlog**: collected, not started. In autonomous mode the worker takes these in
  order; in manual mode they wait for an admin's Start fix (-> queued).
- **queued**: an admin pressed Start fix or Retry; taken before any backlog bug.
- **running** -> **needs_you** (a suggested fix or an escalation waiting for a verdict),
  **failed** (the run broke or hit a limit; Retry queues it again) or **done** (no bug,
  duplicate, or a verdict was given).
"""

from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Callable, Protocol

from bug_hunter.queue.actions import Action
from bug_hunter.signals.base import Candidate

MODES = ("off", "manual", "autonomous")
STATUSES = (
    "backlog",
    "queued",
    "running",
    "needs_you",
    "pr_open",
    "merged",
    "released",
    "failed",
    "done",
)
# graph status (graph/state.py Status) -> board status; anything else is "failed"
NEEDS_YOU = ("suggested_fix", "escalated", "rejected", "awaiting_human", "pr_opened")
DONE = ("closed_not_bug", "closed_duplicate")


def board_status(graph_status: str) -> str:
    if graph_status in NEEDS_YOU:
        return "needs_you"
    if graph_status in DONE:
        return "done"
    return "failed"


# the queue's source names; "reported" is a roadmap bug filed in the product
SOURCES = (
    "reported",
    "issue",
    "ci_failure",
    "error_log",
    "commit_sweep",
    "ux_signal",  # filed by ally-be's UX-signals scan (2026-11-23)
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


@dataclass
class Settings:
    mode: str = "off"
    daily_run_limit: int = 10


@dataclass
class Bug:
    source: str
    signal_key: str
    title: str
    app: str | None = None
    description: str = ""
    payload: dict[str, Any] = field(default_factory=dict)
    reported_by: str = "user"
    status: str = "backlog"
    reason: str | None = None
    run_id: str | None = None
    report_id: int | None = None
    attempts: int = 0
    queued_by: int | None = None
    id: int | None = None
    created_at: datetime = field(default_factory=_now)
    started_at: datetime | None = None
    finished_at: datetime | None = None
    # chunk 11: the bug's draft PR, opened by the strict gate or an admin's Open PR
    pr_url: str | None = None
    pr_number: int | None = None
    pr_opened_at: datetime | None = None
    pr_opened_by: str | None = None  # agent | admin

    @classmethod
    def from_candidate(cls, c: Candidate) -> "Bug":
        return cls(
            source=c.source,
            signal_key=c.key,
            title=c.title[:300],
            app=c.app,
            description=c.summary,
            payload={
                "ref": c.ref,
                "severity_hint": c.severity_hint,
                "extra": c.extra,
            },
            reported_by=c.reported_by,
        )

    def candidate(self) -> Candidate:
        """The Candidate the run path takes. A reported bug runs in issue mode at
        origin/master, like a GitHub issue."""
        # a reported bug and a UX-signal bug run like an issue: a described symptom
        source = "issue" if self.source in ("reported", "ux_signal") else self.source
        reported_by = self.reported_by
        if reported_by not in ("agent", "ci", "monitoring", "staff", "user"):
            reported_by = "user"
        return Candidate(
            source=source,
            app=self.app or "",
            key=self.signal_key,
            title=self.title,
            summary=self.description,
            ref=str(self.payload.get("ref") or self.signal_key),
            reported_by=reported_by,
            severity_hint=str(self.payload.get("severity_hint") or "medium"),
            extra=dict(self.payload.get("extra") or {}),
        )


class SettingsStore(Protocol):
    def get(self) -> Settings: ...

    def set_mode(self, mode: str, by: int | None = None) -> None: ...


class BugQueue(Protocol):
    def add(self, bug: Bug) -> bool: ...  # False when the key is already queued

    def keys_seen(self, keys: list[str]) -> set[str]: ...

    def claim(self, mode: str, now: datetime | None = None) -> Bug | None: ...

    def started_since(self, since: datetime) -> int: ...

    def finish(self, bug_id: int, status: str, **fields: Any) -> None: ...

    def note_waiting(self, reason: str, mode: str) -> None: ...

    def prs_opened_since(self, since: datetime) -> int: ...

    def get(self, bug_id: int) -> Bug | None: ...

    # chunk 11: what an admin asked for that needs git and GitHub
    def pending_actions(self) -> list["Action"]: ...

    def finish_action(self, action_id: int, status: str, result: str) -> None: ...

    # bugs left `running` by a worker that died (crash, kill, a laptop that slept)
    def fail_abandoned(
        self, limit_s: Callable[[str | None], int], now: datetime | None = None
    ) -> list[int]: ...


# A running bug older than its app's wall-clock cap plus this margin has no worker left.
ABANDON_MARGIN_S = 15 * 60


def abandoned(limit_s: int) -> str:
    return (
        f"the worker stopped during this run (no result {limit_s // 60} min after it "
        "started): press Retry"
    )


def claimable(mode: str) -> tuple[str, ...]:
    """Which statuses the worker may start: queued always (an admin asked), backlog
    only in autonomous mode; nothing when off."""
    if mode == "autonomous":
        return ("queued", "backlog")
    if mode == "manual":
        return ("queued",)
    return ()


class InMemorySettings:
    def __init__(self, settings: Settings | None = None):
        self.settings = settings or Settings()

    def get(self) -> Settings:
        return self.settings

    def set_mode(self, mode: str, by: int | None = None) -> None:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {', '.join(MODES)}")
        self.settings.mode = mode


class InMemoryQueue:
    def __init__(self) -> None:
        self.rows: list[Bug] = []
        self.actions: list[Action] = []
        self.action_results: dict[int, tuple[str, str]] = {}

    def get(self, bug_id: int) -> Bug | None:
        return next((b for b in self.rows if b.id == bug_id), None)

    def prs_opened_since(self, since: datetime) -> int:
        return sum(1 for b in self.rows if b.pr_opened_at and b.pr_opened_at >= since)

    def pending_actions(self) -> list[Action]:
        return [a for a in self.actions if a.id not in self.action_results]

    def finish_action(self, action_id: int, status: str, result: str) -> None:
        self.action_results[action_id] = (status, result)

    def add(self, bug: Bug) -> bool:
        if any(b.signal_key == bug.signal_key for b in self.rows):
            return False
        bug.id = len(self.rows) + 1
        self.rows.append(bug)
        return True

    def keys_seen(self, keys: list[str]) -> set[str]:
        wanted = set(keys)
        return {b.signal_key for b in self.rows if b.signal_key in wanted}

    def claim(self, mode: str, now: datetime | None = None) -> Bug | None:
        for status in claimable(mode):
            for b in sorted(self.rows, key=lambda b: (b.created_at, b.id or 0)):
                if b.status == status:
                    b.status, b.reason = "running", None
                    b.attempts += 1
                    b.started_at = now or _now()
                    return b
        return None

    def started_since(self, since: datetime) -> int:
        return sum(1 for b in self.rows if b.started_at and b.started_at >= since)

    def finish(self, bug_id: int, status: str, **fields: Any) -> None:
        b = next(b for b in self.rows if b.id == bug_id)
        b.status = status
        b.finished_at = _now()
        for k, v in fields.items():
            setattr(b, k, v)
        if fields.get("pr_url"):
            b.pr_opened_at = b.pr_opened_at or _now()

    def note_waiting(self, reason: str, mode: str) -> None:
        for b in self.rows:
            if b.status in claimable(mode):
                b.reason = reason

    def fail_abandoned(
        self, limit_s: Callable[[str | None], int], now: datetime | None = None
    ) -> list[int]:
        now = now or _now()
        failed = []
        for b in self.rows:
            if b.status != "running" or b.started_at is None:
                continue
            limit = limit_s(b.app)
            if now - b.started_at > timedelta(seconds=limit):
                b.status, b.reason, b.finished_at = "failed", abandoned(limit), now
                failed.append(b.id)
        return failed


class PostgresSettings:
    def __init__(self, url: str):
        from bug_hunter.graph.checkpointer import connect

        self.conn = connect(url, autocommit=True)

    def get(self) -> Settings:
        row = self.conn.execute(
            "SELECT mode, daily_run_limit FROM bughunter.settings WHERE id = 1"
        ).fetchone()
        return Settings(*row) if row else Settings()

    def set_mode(self, mode: str, by: int | None = None) -> None:
        if mode not in MODES:
            raise ValueError(f"mode must be one of {', '.join(MODES)}")
        self.conn.execute(
            "UPDATE bughunter.settings SET mode = %s, updated_by = %s, "
            "updated_at = now() WHERE id = 1",
            (mode, by),
        )


class PostgresQueue:
    COLS = (
        "source",
        "signal_key",
        "app",
        "title",
        "description",
        "payload",
        "reported_by",
    )

    def __init__(self, url: str):
        from psycopg.rows import dict_row

        from bug_hunter.graph.checkpointer import connect

        self.conn = connect(url, autocommit=True, row_factory=dict_row)

    @staticmethod
    def _row(row: dict[str, Any]) -> Bug:
        data = {k: row[k] for k in Bug.__dataclass_fields__ if k in row}
        if isinstance(data.get("payload"), str):
            data["payload"] = json.loads(data["payload"])
        return Bug(**data)

    def add(self, bug: Bug) -> bool:
        from psycopg.types.json import Jsonb

        d = asdict(bug)
        d["payload"] = Jsonb(d["payload"])
        row = self.conn.execute(
            f"INSERT INTO bughunter.bugs ({', '.join(self.COLS)}) VALUES "
            f"({', '.join('%(' + c + ')s' for c in self.COLS)}) "
            "ON CONFLICT (signal_key) DO NOTHING RETURNING id",
            d,
        ).fetchone()
        if row:
            bug.id = row["id"]
        return row is not None

    def keys_seen(self, keys: list[str]) -> set[str]:
        if not keys:
            return set()
        rows = self.conn.execute(
            "SELECT signal_key FROM bughunter.bugs WHERE signal_key = ANY(%s)",
            (keys,),
        ).fetchall()
        return {r["signal_key"] for r in rows}

    def claim(self, mode: str, now: datetime | None = None) -> Bug | None:
        # `now` is for the in-memory fake; Postgres stamps its own clock
        statuses = list(claimable(mode))
        if not statuses:
            return None
        # queued first (an admin asked), then the oldest; SKIP LOCKED so two workers
        # never take the same bug
        row = self.conn.execute(
            """UPDATE bughunter.bugs SET status = 'running', reason = NULL,
                 attempts = attempts + 1, started_at = now(), updated_at = now()
               WHERE id = (
                 SELECT id FROM bughunter.bugs WHERE status = ANY(%s)
                 ORDER BY (status = 'queued') DESC, created_at, id
                 LIMIT 1 FOR UPDATE SKIP LOCKED)
               RETURNING *""",
            (statuses,),
        ).fetchone()
        return self._row(row) if row else None

    def started_since(self, since: datetime) -> int:
        row = self.conn.execute(
            "SELECT count(*) AS n FROM bughunter.bugs WHERE started_at >= %s",
            (since,),
        ).fetchone()
        return int(row["n"])

    def get(self, bug_id: int) -> Bug | None:
        row = self.conn.execute(
            "SELECT * FROM bughunter.bugs WHERE id = %s", (bug_id,)
        ).fetchone()
        return self._row(row) if row else None

    def prs_opened_since(self, since: datetime) -> int:
        row = self.conn.execute(
            "SELECT count(*) AS n FROM bughunter.bugs WHERE pr_opened_at >= %s",
            (since,),
        ).fetchone()
        return int(row["n"])

    def pending_actions(self) -> list[Action]:
        rows = self.conn.execute(
            "SELECT id, bug_id, kind, requested_by FROM bughunter.actions "
            "WHERE status = 'pending' ORDER BY id"
        ).fetchall()
        return [Action(**r) for r in rows]

    def finish_action(self, action_id: int, status: str, result: str) -> None:
        self.conn.execute(
            "UPDATE bughunter.actions SET status = %s, result = %s, "
            "finished_at = now() WHERE id = %s AND status = 'pending'",
            (status, result[:2000], action_id),
        )

    def finish(self, bug_id: int, status: str, **fields: Any) -> None:
        allowed = {
            "reason",
            "run_id",
            "report_id",
            "app",
            "pr_url",
            "pr_number",
            "pr_opened_by",
        }
        sets = ["status = %(status)s", "finished_at = now()", "updated_at = now()"]
        sets += [f"{k} = %({k})s" for k in fields if k in allowed]
        if fields.get("pr_url"):
            sets.append("pr_opened_at = coalesce(pr_opened_at, now())")
        self.conn.execute(
            f"UPDATE bughunter.bugs SET {', '.join(sets)} WHERE id = %(id)s",
            {"status": status, "id": bug_id, **fields},
        )

    def fail_abandoned(
        self, limit_s: Callable[[str | None], int], now: datetime | None = None
    ) -> list[int]:
        # `now` is for the in-memory fake; Postgres compares with its own clock
        rows = self.conn.execute(
            "SELECT id, app, extract(epoch FROM now() - started_at) AS age_s "
            "FROM bughunter.bugs WHERE status = 'running' AND started_at IS NOT NULL"
        ).fetchall()
        failed = []
        for row in rows:
            limit = limit_s(row["app"])
            if float(row["age_s"]) > limit:
                # only if it is still running: a worker that finished meanwhile wins
                done = self.conn.execute(
                    "UPDATE bughunter.bugs SET status = 'failed', reason = %s, "
                    "finished_at = now(), updated_at = now() "
                    "WHERE id = %s AND status = 'running' RETURNING id",
                    (abandoned(limit), row["id"]),
                ).fetchone()
                if done:
                    failed.append(int(row["id"]))
        return failed

    def note_waiting(self, reason: str, mode: str) -> None:
        statuses = list(claimable(mode))
        if statuses:
            self.conn.execute(
                "UPDATE bughunter.bugs SET reason = %s, updated_at = now() "
                "WHERE status = ANY(%s) AND reason IS DISTINCT FROM %s",
                (reason, statuses, reason),
            )
