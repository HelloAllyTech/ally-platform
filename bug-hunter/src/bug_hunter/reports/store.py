"""``bughunter.reports`` behind an interface, and the private-repo issue client.

The issue client refuses any repository that is not private, and the public
ally-platform repository by name, before it posts anything (user rule 2026-11-15).
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any, Protocol

PUBLIC_REPO = "HelloAllyTech/ally-platform"


class PublicRepoRefused(RuntimeError):
    pass


@dataclass
class Report:
    day: str
    source: str
    app: str
    signal_key: str
    status: str
    title: str
    body_md: str = ""
    run_id: str | None = None
    cost_usd: float = 0.0
    private_issue: str | None = None
    # what the dashboard shows (chunk 09); all scrubbed by the bug hunter
    finding: dict[str, Any] | None = None
    root_cause: str | None = None
    repro: dict[str, Any] | None = None
    patch_diff: str | None = None
    review: dict[str, Any] | None = None
    confidence: str | None = None
    risk_level: str | None = None
    stop_reason: str | None = None
    severity: str | None = None
    id: int | None = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat(timespec="seconds")
    )


class ReportStore(Protocol):
    def add(self, report: Report) -> Report: ...

    def for_day(self, day: str) -> list[Report]: ...

    def keys_seen(self, keys: list[str]) -> set[str]: ...


class InMemoryReports:
    def __init__(self) -> None:
        self.rows: list[Report] = []

    def add(self, report: Report) -> Report:
        report.id = len(self.rows) + 1
        self.rows.append(report)
        return report

    def for_day(self, day: str) -> list[Report]:
        return [r for r in self.rows if r.day == day]

    def keys_seen(self, keys: list[str]) -> set[str]:
        return {r.signal_key for r in self.rows if r.signal_key in set(keys)}


class PostgresReports:
    COLS = (
        "day",
        "source",
        "app",
        "signal_key",
        "status",
        "title",
        "body_md",
        "run_id",
        "cost_usd",
        "private_issue",
        "finding",
        "root_cause",
        "repro",
        "patch_diff",
        "review",
        "confidence",
        "risk_level",
        "stop_reason",
        "severity",
    )
    JSON_COLS = ("finding", "repro", "review")

    def __init__(self, url: str):
        from psycopg import Connection
        from psycopg.rows import dict_row

        self.conn = Connection.connect(url, autocommit=True, row_factory=dict_row)

    def _row(self, row: dict[str, Any]) -> Report:
        data = {k: row[k] for k in Report.__dataclass_fields__ if k in row}
        data["day"] = str(data["day"])
        data["cost_usd"] = float(data.get("cost_usd") or 0)
        if not isinstance(data.get("created_at"), str):
            data["created_at"] = data["created_at"].isoformat(timespec="seconds")
        return Report(**data)

    def add(self, report: Report) -> Report:
        from psycopg.types.json import Jsonb

        d = asdict(report)
        for col in self.JSON_COLS:
            d[col] = Jsonb(d[col]) if d[col] is not None else None
        row = self.conn.execute(
            f"INSERT INTO bughunter.reports ({', '.join(self.COLS)}) VALUES "
            f"({', '.join('%(' + c + ')s' for c in self.COLS)}) RETURNING *",
            d,
        ).fetchone()
        return self._row(row)

    def for_day(self, day: str) -> list[Report]:
        rows = self.conn.execute(
            "SELECT * FROM bughunter.reports WHERE day = %s ORDER BY id", (day,)
        ).fetchall()
        return [self._row(r) for r in rows]

    def keys_seen(self, keys: list[str]) -> set[str]:
        if not keys:
            return set()
        rows = self.conn.execute(
            "SELECT DISTINCT signal_key FROM bughunter.reports "
            "WHERE signal_key = ANY(%s)",
            (keys,),
        ).fetchall()
        return {r["signal_key"] for r in rows}


class IssueClient(Protocol):
    def repo_visibility(self, repo: str) -> str: ...

    def create_issue(
        self, repo: str, title: str, body: str, labels: list[str]
    ) -> str: ...


class PrivateReportsRepo:
    """Issues in the private reports repo only."""

    def __init__(self, client: IssueClient, repo: str):
        if repo.lower() == PUBLIC_REPO.lower():
            raise PublicRepoRefused(f"{repo} is public: reports never go there")
        self.client = client
        self.repo = repo
        self._checked = False

    def post(self, title: str, body: str, labels: list[str]) -> str:
        if not self._checked:
            visibility = self.client.repo_visibility(self.repo)
            if visibility != "private":
                raise PublicRepoRefused(
                    f"{self.repo} is {visibility}, not private: nothing posted"
                )
            self._checked = True
        return self.client.create_issue(self.repo, title[:250], body, labels)
