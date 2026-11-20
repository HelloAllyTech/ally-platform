"""Chunk 10: the three modes, the bug queue and the worker (fakes, no model)."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from bug_hunter.queue.store import (
    ABANDON_MARGIN_S,
    Bug,
    InMemoryQueue,
    InMemorySettings,
    Settings,
    board_status,
    claimable,
)
from bug_hunter.queue.worker import APP_UNKNOWN, day_start, work_loop, work_once
from bug_hunter.reports.store import InMemoryReports
from bug_hunter.signals.dispatcher import RunOutcome, run_daily
from bug_hunter.signals.state import ENABLED, InMemoryState
from tests.test_dispatcher import NOW, cand, sources
from tests.test_spend import MemoryLedger


def bug(key, app="ally-be", source="reported", status="backlog", minutes=0):
    b = Bug(
        source=source,
        signal_key=key,
        title=f"title {key}",
        app=app,
        description="the save button does nothing",
    )
    b.status = status
    b.created_at = NOW - timedelta(minutes=60 - minutes)
    return b


class Runs:
    """A start_run fake: records candidates, answers with a scripted status."""

    def __init__(self, status="suggested_fix", cost=0.6, fail=False):
        self.status, self.cost, self.fail = status, cost, fail
        self.started = []

    def __call__(self, c):
        self.started.append(c)
        if self.fail:
            raise RuntimeError("sandbox died")
        return RunOutcome(
            f"run-{c.key}",
            self.status,
            self.cost,
            "# report\n",
            details={"stop_reason": "budget: wall clock"},
        )


def work(config, settings, queue, runs, ledger=None, reports=None, state=None, now=NOW):
    return work_once(
        config,
        settings,
        queue,
        reports or InMemoryReports(),
        ledger or MemoryLedger(),
        runs,
        state=state,
        now=now,
    )


# --- modes ---------------------------------------------------------------------


def test_off_starts_nothing_even_a_queued_bug(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("a", status="queued"))
    result = work(config, InMemorySettings(Settings("off")), queue, runs)
    assert result.action == "off" and runs.started == []
    assert queue.rows[0].status == "queued"


def test_manual_starts_only_what_an_admin_queued(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("backlog-1"))
    settings = InMemorySettings(Settings("manual"))
    assert work(config, settings, queue, runs).action == "idle"
    assert runs.started == []
    queue.add(bug("pressed", status="queued", minutes=30))
    result = work(config, settings, queue, runs)
    assert result.action == "ran" and [c.key for c in runs.started] == ["pressed"]
    assert queue.rows[0].status == "backlog"


def test_autonomous_takes_queued_first_then_the_oldest_backlog(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("newer", minutes=50))
    queue.add(bug("older", minutes=10))
    queue.add(bug("pressed", status="queued", minutes=59))
    settings = InMemorySettings(Settings("autonomous"))
    for _ in range(3):
        work(config, settings, queue, runs)
    assert [c.key for c in runs.started] == ["pressed", "older", "newer"]


def test_claimable_statuses_per_mode() -> None:
    assert claimable("off") == ()
    assert claimable("manual") == ("queued",)
    assert claimable("autonomous") == ("queued", "backlog")


def test_pause_stops_the_worker_in_any_mode(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("a", status="queued"))
    result = work(
        config,
        InMemorySettings(Settings("autonomous")),
        queue,
        runs,
        state=InMemoryState({ENABLED: False}),
    )
    assert result.action == "paused" and runs.started == []


# --- caps ----------------------------------------------------------------------


def test_daily_run_limit_leaves_the_rest_waiting_with_the_reason(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    for i in range(4):
        queue.add(bug(f"b{i}", minutes=i))
    settings = InMemorySettings(Settings("autonomous", daily_run_limit=2))
    results = [work(config, settings, queue, runs).action for _ in range(4)]
    assert results == ["ran", "ran", "waiting", "waiting"]
    waiting = [b for b in queue.rows if b.status == "backlog"]
    assert len(waiting) == 2
    assert all("daily run limit (2)" in (b.reason or "") for b in waiting)


def test_the_run_count_resets_at_midnight_ist(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("late", minutes=0))
    queue.add(bug("same-night", minutes=1))
    queue.add(bug("next-day", minutes=2))
    settings = InMemorySettings(Settings("autonomous", daily_run_limit=1))
    evening = NOW - timedelta(hours=4)  # 23:30 IST on the 15th
    assert work(config, settings, queue, runs, now=evening).action == "ran"
    later = NOW - timedelta(hours=3, minutes=40)  # 23:50 IST, same day: limit holds
    assert work(config, settings, queue, runs, now=later).action == "waiting"
    assert work(config, settings, queue, runs, now=NOW).action == "ran"  # 03:30 IST
    assert [c.key for c in runs.started] == ["late", "same-night"]


def test_spend_cap_leaves_bugs_waiting(config) -> None:
    from bug_hunter import spend

    ledger = MemoryLedger()
    spend.record(14.9, "test", "near the cap", path=ledger, at=NOW)
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("a", status="queued"))
    result = work(
        config, InMemorySettings(Settings("autonomous")), queue, runs, ledger=ledger
    )
    assert result.action == "waiting" and "spend cap" in (result.reason or "")
    assert runs.started == [] and "spend cap" in (queue.rows[0].reason or "")


# --- outcomes ------------------------------------------------------------------


def test_board_status_of_each_graph_outcome() -> None:
    assert board_status("suggested_fix") == "needs_you"
    assert board_status("escalated") == "needs_you"
    assert board_status("closed_not_bug") == "done"
    assert board_status("closed_duplicate") == "done"
    assert board_status("failed") == "failed"
    assert board_status("fixing") == "failed"  # a run that stopped part-way


def test_a_suggested_fix_lands_in_needs_you_with_its_report(config) -> None:
    queue, runs, reports, ledger = (
        InMemoryQueue(),
        Runs(),
        InMemoryReports(),
        MemoryLedger(),
    )
    queue.add(bug("a", status="queued"))
    result = work(
        config,
        InMemorySettings(Settings("manual")),
        queue,
        runs,
        ledger=ledger,
        reports=reports,
    )
    row = queue.rows[0]
    assert (result.status, row.status, row.run_id) == (
        "needs_you",
        "needs_you",
        "run-a",
    )
    assert row.report_id == reports.rows[0].id
    assert reports.rows[0].source == "reported"
    # The run records its cost on the real clock, so check the ledger, not a fixed day.
    assert sum(e.usd for e in ledger.entries()) > 0


def test_a_run_that_raises_is_failed_with_the_reason_and_can_be_retried(config) -> None:
    queue = InMemoryQueue()
    queue.add(bug("a", status="queued"))
    settings = InMemorySettings(Settings("manual"))
    work(config, settings, queue, Runs(fail=True))
    row = queue.rows[0]
    assert row.status == "failed" and "sandbox died" in (row.reason or "")
    row.status = "queued"  # Retry in the dashboard
    work(config, settings, queue, Runs())
    assert row.status == "needs_you" and row.attempts == 2


def test_a_bug_left_running_by_a_dead_worker_fails_with_the_reason(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("dead", status="running"))
    queue.add(bug("alive", app="ally-web", status="running"))
    limit = config.limits.run.wall_clock_s("ally-be") + ABANDON_MARGIN_S
    queue.rows[0].started_at = NOW - timedelta(seconds=limit + 1)
    # ally-web's cap is longer: the same age is still a live run there
    queue.rows[1].started_at = NOW - timedelta(seconds=limit + 1)
    result = work(config, InMemorySettings(Settings("off")), queue, runs)
    assert result.action == "off" and runs.started == []
    dead, alive = queue.rows
    assert dead.status == "failed" and "press Retry" in (dead.reason or "")
    assert alive.status == "running"


def test_a_run_still_inside_its_cap_is_left_alone(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("slow", status="running"))
    queue.rows[0].started_at = NOW - timedelta(minutes=30)
    work(config, InMemorySettings(Settings("manual")), queue, runs)
    assert queue.rows[0].status == "running"


def test_no_bug_is_done(config) -> None:
    queue = InMemoryQueue()
    queue.add(bug("a", status="queued"))
    work(config, InMemorySettings(Settings("manual")), queue, Runs("closed_not_bug"))
    assert (queue.rows[0].status, queue.rows[0].reason) == ("done", "no bug")


def test_a_reported_bug_without_an_app_goes_back_to_backlog_unrun(config) -> None:
    queue, runs = InMemoryQueue(), Runs()
    queue.add(bug("a", app=None, status="queued"))
    work(config, InMemorySettings(Settings("autonomous")), queue, runs)
    assert runs.started == []
    assert (queue.rows[0].status, queue.rows[0].reason) == ("backlog", APP_UNKNOWN)


def test_a_reported_bug_runs_in_issue_mode_as_reported_by_a_user(config) -> None:
    c = bug("reported:42").candidate()
    assert (c.source, c.reported_by, c.summary) == (
        "issue",
        "user",
        "the save button does nothing",
    )


# --- the daily job feeds the queue ---------------------------------------------


def test_live_daily_with_a_queue_queues_everything_fresh_and_runs_nothing(
    config,
) -> None:
    queue, state = InMemoryQueue(), InMemoryState()
    queue.add(Bug.from_candidate(cand("ci_failure", "c-old")))

    def never(_c):
        raise AssertionError("the daily job must not start runs with a queue")

    plan = run_daily(
        config,
        state,
        sources(
            ci_failures=[cand("ci_failure", "c-old"), cand("ci_failure", "c-new")],
            issues=[cand("issue", "i1")],
        ),
        InMemoryReports(),
        MemoryLedger(),
        start_run=never,
        dry_run=False,
        now=NOW,
        queue=queue,
    )
    assert plan.queued and [c.key for c in plan.selected] == ["c-new", "i1"]
    assert ("c-old", "already reported") in plan.skipped
    assert {b.signal_key for b in queue.rows} == {"c-old", "c-new", "i1"}
    assert state.get("ci_failures:since") == "now"  # cursors advance
    assert "## Queued (2)" in plan.markdown()


def test_work_loop_goes_straight_on_after_a_run_and_sleeps_otherwise() -> None:
    from bug_hunter.queue.worker import WorkResult

    script = iter([WorkResult("ran", 1, "needs_you"), WorkResult("idle")])
    slept = []
    work_loop(
        lambda: next(script),
        interval_s=5,
        max_iterations=2,
        sleep=slept.append,
        log=lambda _m: None,
    )
    assert slept == [5]


def test_day_start_is_midnight_ist() -> None:
    start = day_start(NOW)  # 03:30 IST on the 16th
    assert start == datetime(2026, 11, 15, 18, 30, tzinfo=timezone.utc)
