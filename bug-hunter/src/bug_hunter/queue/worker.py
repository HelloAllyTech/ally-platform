"""The worker (chunk 10): takes one bug off ``bughunter.bugs`` at a time, according to
the mode, runs it through the same run path as the daily job, files its report and
moves the bug to its board status.

- off: starts nothing (and the daily job collects nothing).
- manual: starts only bugs an admin queued (Start fix / Retry in the dashboard).
- autonomous: starts queued bugs first, then the backlog, oldest first.

Every mode keeps the caps: ``settings.daily_run_limit`` runs per day (default 10,
user 2026-11-16) and the $15/day spend ledger. Past either, bugs stay where they are
with the reason, and start the next day. The kill switch (`bug-hunter pause`) stops
the worker too. Output follows ``pr.output_mode`` (suggested_fix until the holdout
milestone, CONTEXT.md rule 8), whatever the mode.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from datetime import datetime
from datetime import time as dtime
from datetime import timezone
from typing import Callable

from bug_hunter import spend
from bug_hunter.config import BugHunterConfig
from bug_hunter.queue.store import (
    ABANDON_MARGIN_S,
    BugQueue,
    SettingsStore,
    board_status,
)
from bug_hunter.reports.store import PrivateReportsRepo, Report, ReportStore
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.dispatcher import (
    HUMAN_STATUSES,
    REPORT_DETAIL_FIELDS,
    RunOutcome,
)
from bug_hunter.signals.state import SignalState, is_enabled

APP_UNKNOWN = "app unknown: pick the app and press Start fix"


@dataclass
class WorkResult:
    action: str  # off | paused | idle | waiting | ran
    bug_id: int | None = None
    status: str | None = None
    reason: str | None = None
    cost_usd: float = 0.0


def day_start(now: datetime) -> datetime:
    """Midnight of the ledger's day (IST) as a UTC instant, for the run count."""
    local = now.astimezone(spend.ledger_tz())
    start = datetime.combine(local.date(), dtime.min, tzinfo=spend.ledger_tz())
    return start.astimezone(timezone.utc)


def work_once(
    config: BugHunterConfig,
    settings: SettingsStore,
    queue: BugQueue,
    reports: ReportStore,
    ledger: spend.Where,
    start_run: Callable[[Candidate], RunOutcome],
    state: SignalState | None = None,
    reports_repo: PrivateReportsRepo | None = None,
    now: datetime | None = None,
) -> WorkResult:
    now = now or datetime.now(timezone.utc)
    # First, a bug whose worker died mid-run goes to Failed with the reason, so Retry
    # works; otherwise it would sit in In progress for ever. Cleanup, so in every mode.
    queue.fail_abandoned(
        lambda app: config.limits.run.wall_clock_s(app) + ABANDON_MARGIN_S, now=now
    )
    current = settings.get()
    if current.mode == "off":
        return WorkResult("off")
    if state is not None and not is_enabled(state):
        return WorkResult("paused")
    started = queue.started_since(day_start(now))
    if started >= current.daily_run_limit:
        reason = f"waiting: daily run limit ({current.daily_run_limit}) reached"
        queue.note_waiting(reason, current.mode)
        return WorkResult("waiting", reason=reason)
    day = spend.day_of(now.isoformat())
    projected = spend.total_for(day, path=ledger) + config.limits.run.max_cost_usd
    if projected > spend.DAILY_CAP_USD:
        reason = f"waiting: daily spend cap (${spend.DAILY_CAP_USD:.0f})"
        queue.note_waiting(reason, current.mode)
        return WorkResult("waiting", reason=reason)
    bug = queue.claim(current.mode, now=now)
    if bug is None:
        return WorkResult("idle")
    assert bug.id is not None
    if not bug.app or bug.app not in config.limits.signals.apps:
        reason = APP_UNKNOWN if not bug.app else f"{bug.app} is not a rollout app"
        queue.finish(bug.id, "backlog", reason=reason)
        return WorkResult("ran", bug.id, "backlog", reason)
    candidate = bug.candidate()
    try:
        outcome = start_run(candidate)
    except Exception as exc:  # noqa: BLE001 - recorded on the bug, the loop goes on
        outcome = RunOutcome(
            "", "failed", 0.0, f"run failed: {type(exc).__name__}: {exc}"[:500]
        )
    if outcome.cost_usd:
        spend.record(
            outcome.cost_usd, "worker", f"{bug.source} {bug.signal_key}", path=ledger
        )
    report = Report(
        day=day,
        source=bug.source,
        app=bug.app,
        signal_key=bug.signal_key,
        status=outcome.status,
        title=bug.title,
        body_md=outcome.body_md,
        run_id=outcome.run_id or None,
        cost_usd=outcome.cost_usd,
        **{k: v for k, v in outcome.details.items() if k in REPORT_DETAIL_FIELDS},
    )
    if reports_repo is not None and outcome.status in HUMAN_STATUSES:
        report.private_issue = reports_repo.post(
            f"[{outcome.status}] {bug.app}: {bug.title}",
            outcome.body_md,
            ["bug-hunter", bug.source, bug.app, outcome.status],
        )
    saved = reports.add(report)
    status = board_status(outcome.status)
    reason = None
    if status == "failed":
        first_line = outcome.body_md.splitlines()[0][:300] if outcome.body_md else ""
        reason = (
            outcome.details.get("stop_reason")
            or first_line
            or f"run ended as {outcome.status}"
        )
    elif status == "done":
        reason = "no bug" if outcome.status == "closed_not_bug" else "duplicate"
    queue.finish(
        bug.id,
        status,
        reason=reason,
        run_id=outcome.run_id or None,
        report_id=saved.id,
    )
    return WorkResult("ran", bug.id, status, reason, outcome.cost_usd)


def work_loop(
    once: Callable[[], WorkResult],
    interval_s: float = 30.0,
    max_iterations: int | None = None,
    sleep: Callable[[float], None] = time.sleep,
    log: Callable[[str], None] = print,
) -> None:
    """Run ``once`` forever (or ``max_iterations`` times). A run that finished goes
    straight to the next bug; otherwise wait ``interval_s``."""
    n = 0
    while max_iterations is None or n < max_iterations:
        n += 1
        try:
            result = once()
        except Exception as exc:  # noqa: BLE001 - one bad iteration never stops it
            log(f"worker error: {type(exc).__name__}: {exc}")
            sleep(interval_s)
            continue
        if result.action == "ran":
            log(f"bug {result.bug_id} -> {result.status} (${result.cost_usd:.2f})")
            continue
        if result.action == "waiting":
            log(result.reason or "waiting")
        sleep(interval_s)
