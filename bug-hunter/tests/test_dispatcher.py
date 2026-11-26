"""Chunk 08: the daily dispatcher and the private-only reports client (fakes)."""

from __future__ import annotations

from datetime import datetime, timezone

import pytest

from bug_hunter.reports.store import (
    InMemoryReports,
    PrivateReportsRepo,
    PublicRepoRefused,
    Report,
)
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.dispatcher import RunOutcome, run_daily
from bug_hunter.signals.state import ENABLED, InMemoryState
from tests.test_spend import MemoryLedger

NOW = datetime(2026, 11, 15, 22, 0, tzinfo=timezone.utc)  # 03:30 IST on the 16th
DAY = "2026-11-16"


def cand(source, key, app="ally-be", severity="medium"):
    return Candidate(
        source, app, key, f"title {key}", "summary", key, "ci", severity_hint=severity
    )


def sources(**lists):
    return {
        name: (lambda items=items, name=name: (items, {f"{name}:since": "now"}, []))
        for name, items in lists.items()
    }


class Issues:
    def __init__(self, visibility="private"):
        self.visibility = visibility
        self.posted = []

    def repo_visibility(self, repo):
        return self.visibility

    def create_issue(self, repo, title, body, labels):
        self.posted.append((repo, title, labels))
        return f"https://github.com/{repo}/issues/{len(self.posted)}"


def test_dry_run_orders_by_priority_and_caps_without_running(config, tmp_path) -> None:
    state, reports = InMemoryState(), InMemoryReports()
    plan = run_daily(
        config,
        state,
        sources(
            commit_sweep=[cand("commit_sweep", "s1")],
            error_logs=[cand("error_log", "l1", severity="high")],
            issues=[cand("issue", "i1")],
            ci_failures=[cand("ci_failure", "c1"), cand("ci_failure", "c1")],
        ),
        reports,
        MemoryLedger(),
        start_run=lambda c: pytest.fail("a dry run must not start a run"),
        dry_run=True,
        out_dir=tmp_path,
        now=NOW,
    )
    assert plan.day == DAY and plan.dry_run
    assert [c.key for c in plan.selected] == ["c1", "i1", "l1", "s1"]  # deduped too
    assert state.data == {}  # cursors not advanced by a dry run
    assert (
        (tmp_path / f"{DAY}-daily-dry-run.md")
        .read_text()
        .startswith(f"# Bug Hunter daily {DAY} (dry run)")
    )


def test_run_cap_spend_cap_seen_keys_and_rollout(config) -> None:
    reports = InMemoryReports()
    reports.add(Report(DAY, "issue", "ally-be", "old", "escalated", "t", run_id="r0"))
    ledger = MemoryLedger()
    from bug_hunter import spend

    spend.record(11.0, "daily", path=ledger, at=NOW)  # room for 2 runs at $1.50
    cands = [cand("ci_failure", f"c{i}") for i in range(4)] + [
        cand("issue", "old"),
        cand("issue", "web", app="ally-web"),
    ]
    cfg_signals = config.limits.signals.model_copy(update={"apps": ["ally-be"]})
    cfg = config.model_copy(
        update={"limits": config.limits.model_copy(update={"signals": cfg_signals})}
    )
    plan = run_daily(
        cfg,
        InMemoryState(),
        sources(ci_failures=cands),
        reports,
        ledger,
        dry_run=True,
        now=NOW,
    )
    assert [c.key for c in plan.selected] == ["c0", "c1"]
    reasons = dict(plan.skipped)
    assert reasons["old"] == "already reported"
    assert reasons["web"] == "ally-web not in the rollout apps"
    assert reasons["c2"].startswith("daily spend cap")
    assert plan.runs_before == 1


def test_sources_take_turns_so_one_noisy_source_cannot_take_every_slot() -> None:
    from bug_hunter.signals.dispatcher import interleave

    picked = interleave(
        [cand("ci_failure", f"c{i}") for i in range(5)]
        + [cand("commit_sweep", "s1"), cand("error_log", "l1")]
        + [cand("error_log", "l2", severity="high")]
    )
    # priority order within each turn, severity order within a source
    assert [c.key for c in picked][:3] == ["c0", "l2", "s1"]
    assert [c.key for c in picked][3:] == ["c1", "l1", "c2", "c3", "c4"]


def test_paused_runs_nothing(config) -> None:
    plan = run_daily(
        config,
        InMemoryState({ENABLED: False}),
        sources(ci_failures=[cand("ci_failure", "c1")]),
        InMemoryReports(),
        MemoryLedger(),
        dry_run=False,
        now=NOW,
    )
    assert plan.paused and plan.selected == []


def test_a_failing_source_does_not_stop_the_others(config) -> None:
    def broken():
        raise RuntimeError("cloudwatch down")

    srcs = sources(ci_failures=[cand("ci_failure", "c1")])
    srcs["error_logs"] = broken
    plan = run_daily(
        config,
        InMemoryState(),
        srcs,
        InMemoryReports(),
        MemoryLedger(),
        dry_run=True,
        now=NOW,
    )
    assert plan.sources["error_logs"].startswith("error: RuntimeError")
    assert [c.key for c in plan.selected] == ["c1"]


def test_live_run_records_reports_spend_cursors_and_posts_privately(config) -> None:
    state, reports, ledger, gh = (
        InMemoryState(),
        InMemoryReports(),
        MemoryLedger(),
        Issues(),
    )
    outcomes = {
        "c1": RunOutcome("run-1", "suggested_fix", 0.4, "## Suggested fix"),
        "i1": RunOutcome("run-2", "closed_not_bug", 0.1, "no bug"),
    }
    plan = run_daily(
        config,
        state,
        sources(ci_failures=[cand("ci_failure", "c1")], issues=[cand("issue", "i1")]),
        reports,
        ledger,
        start_run=lambda c: outcomes[c.key],
        reports_repo=PrivateReportsRepo(gh, "HelloAllyTech/bug-hunter-reports"),
        dry_run=False,
        now=NOW,
    )
    assert [r.status for r in reports.rows] == ["suggested_fix", "closed_not_bug"]
    assert reports.rows[0].private_issue.endswith("/issues/1")
    assert reports.rows[1].private_issue is None  # no-bug outcomes are not posted
    from bug_hunter import spend

    assert spend.total_for(DAY, path=ledger) == pytest.approx(0.5)
    assert (
        state.get("ci_failures:since") == "now" and state.get("issues:since") == "now"
    )
    assert [p[0] for p in gh.posted] == ["HelloAllyTech/bug-hunter-reports"] * 2
    assert gh.posted[-1][1] == f"Bug Hunter daily summary {DAY}"
    assert plan.outcomes["c1"].status == "suggested_fix"


def test_reports_never_go_to_a_public_repo() -> None:
    with pytest.raises(PublicRepoRefused):
        PrivateReportsRepo(Issues(), "HelloAllyTech/ally-platform")
    repo = PrivateReportsRepo(Issues(visibility="public"), "HelloAllyTech/other")
    with pytest.raises(PublicRepoRefused):
        repo.post("t", "b", [])


def test_daily_cli_live_collects_nothing_when_off_and_sources_fail_soft_without_a_token(
    config, monkeypatch
) -> None:
    from typer.testing import CliRunner

    import bug_hunter.queue.store as queue_store
    from bug_hunter.cli import app, daily_sources
    from bug_hunter.queue.store import InMemorySettings
    from bug_hunter.signals.state import InMemoryState

    # chunk 10: --live queues into bughunter.bugs, and only when the mode is not off
    monkeypatch.setattr(
        queue_store, "PostgresSettings", lambda _url: InMemorySettings()
    )
    result = CliRunner().invoke(app, ["daily", "--live"])
    assert result.exit_code == 0 and "mode is off: nothing collected" in result.output
    srcs = daily_sources(config, InMemoryState(), env={})
    with pytest.raises(RuntimeError, match="GitHub App is not set up"):
        srcs["ci_failures"]()
    found, cursors, notes = srcs["error_logs"]()
    assert found == [] and "no log groups configured" in notes[0]
