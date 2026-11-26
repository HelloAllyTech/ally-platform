"""The daily job (chunk 08): collect every enabled source, dedupe, order by priority,
apply the caps (runs per day, the $15/day ledger) and the kill switch, then either
write the plan (``--dry-run``) or start graph runs and file their reports.

Reports go to ``bughunter.reports`` and, for the ones a human should read, to issues in
the private reports repo. Nothing is posted to the public repository, and a source
that fails never stops the others.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable

from bug_hunter import spend
from bug_hunter.config import BugHunterConfig
from bug_hunter.reports.store import PrivateReportsRepo, Report, ReportStore
from bug_hunter.signals.base import Candidate

if TYPE_CHECKING:
    from bug_hunter.queue.store import BugQueue
from bug_hunter.signals.state import SignalState, is_enabled

SEVERITY = {"critical": 0, "high": 1, "medium": 2, "low": 3}
# what a source returns: (candidates, cursor updates, ignored-with-reason lines)
Collected = tuple[list[Candidate], dict[str, Any], list[str]]
SourceFn = Callable[[], Collected]
HUMAN_STATUSES = ("suggested_fix", "escalated")
REPORT_DETAIL_FIELDS = (
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


@dataclass
class RunOutcome:
    run_id: str
    status: str
    cost_usd: float
    body_md: str  # scrubbed report (report.md + suggested-fix.md)
    details: dict[str, Any] = field(default_factory=dict)  # Report's dashboard fields


@dataclass
class DailyPlan:
    day: str
    dry_run: bool
    paused: bool = False
    queued: bool = False  # chunk 10: candidates went to bughunter.bugs, none ran here
    sources: dict[str, str] = field(default_factory=dict)
    selected: list[Candidate] = field(default_factory=list)
    skipped: list[tuple[str, str]] = field(default_factory=list)  # (key, reason)
    ignored: list[str] = field(default_factory=list)
    outcomes: dict[str, RunOutcome] = field(default_factory=dict)
    spend_before: float = 0.0
    runs_before: int = 0

    def to_dict(self) -> dict[str, Any]:
        return {
            "day": self.day,
            "dry_run": self.dry_run,
            "paused": self.paused,
            "queued": self.queued,
            "sources": self.sources,
            "selected": [c.to_dict() for c in self.selected],
            "skipped": self.skipped,
            "ignored": self.ignored,
            "outcomes": {k: vars(v) for k, v in self.outcomes.items()},
            "spend_before": self.spend_before,
            "runs_before": self.runs_before,
        }

    def markdown(self) -> str:
        head = f"# Bug Hunter daily {self.day}" + (" (dry run)" if self.dry_run else "")
        if self.paused:
            return head + "\n\nPaused (`bug-hunter unpause` to enable). Nothing ran.\n"
        lines = [
            head,
            "",
            f"Spend before: ${self.spend_before:.2f} · graph runs already today: "
            f"{self.runs_before}",
            "",
            "## Sources",
        ]
        lines += [f"- {k}: {v}" for k, v in self.sources.items()]
        lines += [
            "",
            f"## {'Would run' if self.dry_run else 'Queued' if self.queued else 'Ran'}"
            f" ({len(self.selected)})",
        ]
        for c in self.selected:
            out = self.outcomes.get(c.key)
            tail = f" → {out.status} (${out.cost_usd:.2f})" if out else ""
            lines.append(f"- [{c.source}] {c.app}: {c.title}{tail}")
        if self.skipped:
            lines += ["", f"## Not run ({len(self.skipped)})"]
            lines += [f"- {k}: {why}" for k, why in self.skipped]
        if self.ignored:
            lines += ["", f"## Ignored ({len(self.ignored)})"] + [
                f"- {x}" for x in self.ignored
            ]
        return "\n".join(lines) + "\n"


def interleave(candidates: list[Candidate]) -> list[Candidate]:
    """Order for the run slots and the backlog: sources take turns (in priority order,
    each source's own candidates by severity), so one noisy source (a red CI job, a
    burst of log errors) cannot take every slot from the others."""
    by_source: dict[str, list[Candidate]] = {}
    for c in sorted(
        candidates, key=lambda c: (c.priority, SEVERITY.get(c.severity_hint, 2))
    ):
        by_source.setdefault(c.source, []).append(c)
    queues = list(by_source.values())
    out: list[Candidate] = []
    while any(queues):
        for q in queues:
            if q:
                out.append(q.pop(0))
    return out


def run_daily(
    config: BugHunterConfig,
    state: SignalState,
    sources: dict[str, SourceFn],
    reports: ReportStore,
    ledger: spend.Where,
    start_run: Callable[[Candidate], RunOutcome] | None = None,
    reports_repo: PrivateReportsRepo | None = None,
    dry_run: bool = True,
    out_dir: Path | None = None,
    now: datetime | None = None,
    queue: "BugQueue | None" = None,
) -> DailyPlan:
    """With ``queue`` (chunk 10) a live run only adds the fresh candidates to
    ``bughunter.bugs``; the worker starts them according to the mode and applies the
    caps. Without it, the chunk 08 behaviour: start runs here, within the caps."""
    now = now or datetime.now(timezone.utc)
    day = spend.day_of(now.isoformat())
    plan = DailyPlan(day=day, dry_run=dry_run)
    if not is_enabled(state):
        plan.paused = True
        _write(plan, out_dir)
        return plan
    toggles = config.limits.signals
    candidates: list[Candidate] = []
    cursor_updates: dict[str, Any] = {}
    for name, fn in sources.items():
        if not getattr(toggles, name, False):
            plan.sources[name] = "off (limits.yaml signals)"
            continue
        try:
            found, cursors, ignored = fn()
        except Exception as exc:  # noqa: BLE001 - one source never stops the rest
            plan.sources[name] = f"error: {type(exc).__name__}: {str(exc)[:200]}"
            continue
        plan.sources[name] = f"{len(found)} candidate(s)"
        candidates += found
        cursor_updates.update(cursors)
        plan.ignored += ignored
    # dedupe: within today's batch, then against every key already reported
    unique: dict[str, Candidate] = {}
    for c in candidates:
        unique.setdefault(c.key, c)
    seen = reports.keys_seen(list(unique))
    if queue is not None:
        seen |= queue.keys_seen(list(unique))
    fresh = []
    for key, c in unique.items():
        if key in seen:
            plan.skipped.append((key, "already reported"))
        elif c.app not in toggles.apps:
            plan.skipped.append((key, f"{c.app} not in the rollout apps"))
        else:
            fresh.append(c)
    fresh = interleave(fresh)
    if queue is not None and not dry_run:
        from bug_hunter.queue.store import Bug

        plan.queued = True
        for c in fresh:
            if queue.add(Bug.from_candidate(c)):
                plan.selected.append(c)
            else:
                plan.skipped.append((c.key, "already queued"))
        for key, value in cursor_updates.items():
            state.set(key, value)
        _write(plan, out_dir)
        return plan
    # caps: graph runs per day and the daily spend ledger
    today = reports.for_day(day)
    plan.runs_before = sum(1 for r in today if r.run_id)
    plan.spend_before = spend.total_for(day, path=ledger)
    slots = max(0, config.limits.sweep.max_runs_per_day - plan.runs_before)
    per_run = config.limits.run.max_cost_usd
    for c in fresh:
        projected = plan.spend_before + per_run * (len(plan.selected) + 1)
        if len(plan.selected) >= slots:
            plan.skipped.append((c.key, "daily run cap reached"))
        elif projected > spend.DAILY_CAP_USD:
            plan.skipped.append(
                (
                    c.key,
                    f"daily spend cap: ${projected:.2f} > ${spend.DAILY_CAP_USD:.0f}",
                )
            )
        else:
            plan.selected.append(c)
    if dry_run or start_run is None:
        _write(plan, out_dir)
        return plan  # a dry run never advances cursors and starts nothing
    for c in plan.selected:
        if not is_enabled(state):  # paused mid-run: stop before the next one
            plan.skipped.append((c.key, "paused during the run"))
            continue
        try:
            outcome = start_run(c)
        except Exception as exc:  # noqa: BLE001 - record and go on
            outcome = RunOutcome("", "failed", 0.0, f"run failed: {exc}"[:500])
        plan.outcomes[c.key] = outcome
        if outcome.cost_usd:
            spend.record(
                outcome.cost_usd, "daily", f"{c.source} {c.key}", path=ledger, at=now
            )
        report = Report(
            day=day,
            source=c.source,
            app=c.app,
            signal_key=c.key,
            status=outcome.status,
            title=c.title,
            body_md=outcome.body_md,
            run_id=outcome.run_id or None,
            cost_usd=outcome.cost_usd,
            **{k: v for k, v in outcome.details.items() if k in REPORT_DETAIL_FIELDS},
        )
        if reports_repo is not None and outcome.status in HUMAN_STATUSES:
            report.private_issue = reports_repo.post(
                f"[{outcome.status}] {c.app}: {c.title}",
                outcome.body_md,
                ["bug-hunter", c.source, c.app, outcome.status],
            )
        reports.add(report)
    for key, value in cursor_updates.items():
        state.set(key, value)
    if reports_repo is not None:
        reports_repo.post(
            f"Bug Hunter daily summary {day}", plan.markdown(), ["daily-summary"]
        )
    _write(plan, out_dir)
    return plan


def _write(plan: DailyPlan, out_dir: Path | None) -> None:
    if out_dir is None:
        return
    out_dir.mkdir(parents=True, exist_ok=True)
    name = f"{plan.day}-daily" + ("-dry-run" if plan.dry_run else "")
    (out_dir / f"{name}.json").write_text(json.dumps(plan.to_dict(), indent=1))
    (out_dir / f"{name}.md").write_text(plan.markdown())
