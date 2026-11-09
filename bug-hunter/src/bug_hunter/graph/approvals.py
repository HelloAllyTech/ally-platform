"""The ``approvals`` table (spec §13a) behind an interface: Postgres for real runs,
in memory for tests. The admin-dashboard UI arrives in chunk 09; until then
``bug-hunter resume <run_id> --approve|--reject`` records the decision."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Protocol

from bug_hunter.config import PACKAGE_ROOT

MIGRATIONS_DIR = PACKAGE_ROOT / "migrations"


@dataclass
class Approval:
    id: str
    app: str
    title: str
    severity: str
    risk_level: str
    confidence: str | None
    root_cause: str
    repro_test: str
    files_changed: list[str]
    pr_url: str | None
    ci_status: str | None
    expires_at: str
    status: str = "pending"
    decided_by: str | None = None
    decided_at: str | None = None
    reason: str | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )


class ApprovalStore(Protocol):
    def create(self, approval: Approval) -> None: ...

    def get(self, approval_id: str) -> Approval | None: ...

    def decide(
        self, approval_id: str, decision: str, by: str, reason: str
    ) -> Approval: ...


def expiry(days: int) -> str:
    return (datetime.now(timezone.utc) + timedelta(days=days)).isoformat(
        timespec="seconds"
    )


class InMemoryApprovals:
    def __init__(self) -> None:
        self.rows: dict[str, Approval] = {}

    def create(self, approval: Approval) -> None:
        self.rows[approval.id] = approval

    def get(self, approval_id: str) -> Approval | None:
        return self.rows.get(approval_id)

    def decide(self, approval_id: str, decision: str, by: str, reason: str) -> Approval:
        row = self.rows[approval_id]
        row.status = decision
        row.decided_by = by
        row.decided_at = datetime.now(timezone.utc).isoformat(timespec="seconds")
        row.reason = reason
        return row


class PostgresApprovals:
    """Rows in ``bughunter.approvals``; ``migrate()`` applies ``migrations/*.sql``."""

    def __init__(self, url: str):
        from psycopg import Connection
        from psycopg.rows import dict_row

        self.conn = Connection.connect(url, autocommit=True, row_factory=dict_row)

    @staticmethod
    def migrate(url: str, migrations: Path = MIGRATIONS_DIR) -> list[str]:
        from psycopg import Connection

        applied = []
        with Connection.connect(url, autocommit=True) as conn:
            for path in sorted(migrations.glob("*.sql")):
                conn.execute(path.read_text(encoding="utf-8"))
                applied.append(path.name)
        return applied

    def create(self, approval: Approval) -> None:
        d = asdict(approval)
        self.conn.execute(
            """INSERT INTO bughunter.approvals (id, app, title, severity, risk_level,
               confidence, root_cause, repro_test, files_changed, pr_url, ci_status,
               status, expires_at)
               VALUES (%(id)s, %(app)s, %(title)s, %(severity)s, %(risk_level)s,
               %(confidence)s, %(root_cause)s, %(repro_test)s, %(files_changed)s,
               %(pr_url)s, %(ci_status)s, %(status)s, %(expires_at)s)
               ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status""",
            d,
        )

    def get(self, approval_id: str) -> Approval | None:
        row = self.conn.execute(
            "SELECT * FROM bughunter.approvals WHERE id = %s", (approval_id,)
        ).fetchone()
        if row is None:
            return None
        row = dict(row)
        for key in ("decided_at", "created_at", "expires_at"):
            if row.get(key) is not None and not isinstance(row[key], str):
                row[key] = row[key].isoformat(timespec="seconds")
        return Approval(**{k: row[k] for k in Approval.__dataclass_fields__})

    def decide(self, approval_id: str, decision: str, by: str, reason: str) -> Approval:
        self.conn.execute(
            """UPDATE bughunter.approvals SET status = %s, decided_by = %s,
               decided_at = now(), reason = %s WHERE id = %s""",
            (decision, by, reason, approval_id),
        )
        row = self.get(approval_id)
        assert row is not None
        return row
