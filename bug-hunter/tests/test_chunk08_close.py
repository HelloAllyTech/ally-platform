"""Chunk 08 close-out: live-run hook, human-only routing, approval expiry, sources."""

from __future__ import annotations

from types import SimpleNamespace

import pytest

from bug_hunter.graph.approvals import Approval, InMemoryApprovals
from bug_hunter.signals.base import Candidate
from bug_hunter.signals.runner import make_start_run, ref_for, signal_for


def cand(source="ci_failure", **extra):
    return Candidate(
        source,
        "ally-be",
        f"{source}:k",
        "title",
        "summary text",
        "abc123" * 7,
        "ci",
        extra=extra,
    )


def test_human_only_candidates_never_start_a_graph_run(config) -> None:
    start = make_start_run(config, lambda *a: pytest.fail("no graph run"))
    out = start(cand("commit_sweep", human_only=True))
    assert out.status == "escalated" and out.cost_usd == 0.0 and out.run_id == ""
    assert "does not investigate or fix it automatically" in out.body_md


def test_graph_runs_get_the_right_commit_and_signal(config, tmp_path) -> None:
    (tmp_path / "report.md").write_text("# Run r1: suggested_fix")
    seen = []

    def fake_run(cfg, app, ref, signal, memory):
        seen.append((app, ref, signal.source, signal.raw_summary, memory))
        state = SimpleNamespace(
            status="suggested_fix", budget_used=SimpleNamespace(cost_usd=0.42)
        )
        return "r1", state, tmp_path

    start = make_start_run(config, fake_run, memory="mem")
    out = start(cand("ci_failure"))
    assert (out.run_id, out.status, out.cost_usd) == ("r1", "suggested_fix", 0.42)
    assert out.body_md.startswith("# Run r1")
    assert (
        seen[0][:3] == ("ally-be", "abc123" * 7, "ci_failure") and seen[0][4] == "mem"
    )
    assert ref_for(cand("issue")) == "origin/master"
    assert signal_for(cand("error_log")).reported_by == "ci"


def test_pending_approvals_expire_after_their_date() -> None:
    store = InMemoryApprovals()
    for i, exp in enumerate(["2026-11-01T00:00:00+00:00", "2026-12-01T00:00:00+00:00"]):
        store.create(
            Approval(
                id=f"r{i}",
                app="ally-be",
                title="t",
                severity="low",
                risk_level="low",
                confidence=None,
                root_cause="",
                repro_test="",
                files_changed=[],
                pr_url=None,
                ci_status=None,
                expires_at=exp,
            )
        )
    assert store.expire(now="2026-11-16T00:00:00+00:00") == ["r0"]
    assert store.get("r0").status == "expired" and store.get("r1").status == "pending"


def test_daily_sources_option_rejects_unknown_names() -> None:
    from typer.testing import CliRunner

    from bug_hunter.cli import app

    result = CliRunner().invoke(app, ["daily", "--sources", "ci_failures,nope"])
    assert result.exit_code != 0


def test_deploy_units_share_one_lock_and_never_use_actions() -> None:
    from bug_hunter.config import PACKAGE_ROOT

    units = {p.name: p.read_text() for p in (PACKAGE_ROOT / "deploy").glob("*")}
    assert set(units) == {
        "bug-hunter-daily.service",
        "bug-hunter-daily.timer",
        "bug-hunter-poll.service",
        "bug-hunter-poll.timer",
        "bug-hunter-worker.service",
        "provision.sh",
        "update.sh",
        "README.md",
    }
    for name in ("bug-hunter-daily.service", "bug-hunter-poll.service"):
        assert "flock -n /var/lib/bug-hunter/run.lock" in units[name]
    for name in (n for n in units if n.endswith(".service")):
        assert "EnvironmentFile=/etc/bug-hunter/env" in units[name]
        assert "User=bughunter" in units[name]
    assert "03:30:00 Asia/Kolkata" in units["bug-hunter-daily.timer"]
    systemd = "".join(v for k, v in units.items() if k.startswith("bug-hunter-"))
    # live since 2026-11-26 (user): the daily job queues, the worker runs by mode;
    # the 15-minute poll stays a dry run
    assert "daily --live --with-lenses" in units["bug-hunter-daily.service"]
    assert "--live" not in units["bug-hunter-poll.service"]
    # the daily job pulls master first; the worker restarts itself on new code
    assert "ExecStartPre=+/opt/ally-platform/bug-hunter/deploy/update.sh" in (
        units["bug-hunter-daily.service"]
    )
    assert "Restart=always" in units["bug-hunter-worker.service"]
    assert "checkout --quiet --detach" in units["update.sh"]


def test_report_details_come_from_the_run(config, tmp_path) -> None:
    import subprocess

    from bug_hunter.signals.runner import details_from_state
    from tests.test_graph_chunk06 import EDIT_FIX, RUN_REPRO, SUBMIT_FIX, _deps, _run

    root = tmp_path / "wt"
    (root / "ally-be/src").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/src/x.ts").write_text(
        "export const x = () => {\n  return 0; // bug\n};\n"
    )
    for args in (["init", "-q", "-b", "master"], ["add", "."], ["commit", "-qm", "i"]):
        subprocess.run(
            ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
            cwd=root,
            check=True,
            capture_output=True,
        )
    deps = _deps(
        config,
        root,
        tmp_path,
        [EDIT_FIX, RUN_REPRO, SUBMIT_FIX],
        output_mode="suggested_fix",
    )
    _, state = _run(deps)
    assert state.status == "suggested_fix"
    d = details_from_state(state, tmp_path / "artefacts")
    assert d["finding"]["title"] == "x returns 0" and d["severity"] == "medium"
    assert d["repro"]["test_name"] == "x returns 3"
    assert d["repro"]["source"] == "tests src/x.ts"
    assert d["patch_diff"].startswith("diff --git")
    assert d["review"]["verdict"] == "approve" and d["review"]["disputed"] is False
    assert d["risk_level"] == "low"


def test_human_only_reports_carry_their_finding() -> None:
    from bug_hunter.signals.runner import human_only_outcome

    out = human_only_outcome(cand("commit_sweep", human_only=True))
    assert out.details["finding"]["title"] == "title"
    assert out.details["stop_reason"].startswith("routed to a human")
