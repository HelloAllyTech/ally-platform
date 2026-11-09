"""CLI argument checks for run/replay, the harness cost cap, and the report's cost
and trace columns."""

from __future__ import annotations

from pathlib import Path

from typer.testing import CliRunner

from bug_hunter.cli import app
from bug_hunter.graph.checkpointer import CheckpointerError
from evals.agents import AgentResult, BaselineAgent
from evals.metrics import render_markdown
from evals.run_evals import DiskGuard, run_evals
from tests.test_evals_harness import _options

runner = CliRunner()


def test_run_requires_exactly_one_signal() -> None:
    result = runner.invoke(app, ["run", "--app", "ally-be"])
    assert result.exit_code == 1 and "exactly one of" in result.output
    result = runner.invoke(app, ["run", "--issue-text", "x", "--commit", "abc"])
    assert result.exit_code == 1
    result = runner.invoke(app, ["run", "--issue-text", "x"])
    assert result.exit_code == 1 and "--app is required" in result.output


def test_replay_reports_an_unreachable_checkpoint_database(monkeypatch) -> None:
    from contextlib import contextmanager

    @contextmanager
    def unreachable(*_, **__):
        raise CheckpointerError("could not open the checkpoint database at x:***@h")
        yield  # pragma: no cover

    monkeypatch.setattr("bug_hunter.graph.checkpointer.open_checkpointer", unreachable)
    result = runner.invoke(app, ["replay", "run-nope"])
    assert result.exit_code == 1 and "checkpoint database" in result.output
    assert "***" in result.output  # the password never prints


class CostlyAgent:
    name = "costly"

    def run(self, case_input, run) -> AgentResult:
        return AgentResult(
            found=False, cost_usd=6.0, tokens=1000, trace_url="https://smith/x"
        )


def test_cost_cap_stops_the_harness_cleanly(
    repo_config, tmp_path: Path
) -> None:  # noqa: F811,E501
    cfg, repo, bug, clean = repo_config
    cases = [bug, clean, bug.model_copy(update={"id": "ally-be-bug00002"})]
    report, path = run_evals(
        cfg,
        cases,
        CostlyAgent(),
        _options(max_cost_usd=10.0),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert len(report.cases) == 2  # 6 + 6 >= 10 → the third case never runs
    assert "cost cap $10.00 reached" in report.meta["stopped_reason"]
    assert report.meta["cases_remaining"] == 1 and report.meta["cost_usd_total"] == 12.0
    md = render_markdown(report.to_dict())
    assert (
        "| tokens | cost |" in md
        and "$6.000" in md
        and "[trace](https://smith/x)" in md
    )
    assert "Cost: $12.00 of the $10.00 cap" in md


def test_default_cost_cap_comes_from_limits(
    repo_config, tmp_path: Path
) -> None:  # noqa: F811,E501
    cfg, repo, bug, _clean = repo_config
    report, _ = run_evals(
        cfg,
        [bug],
        BaselineAgent(),
        _options(),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert report.meta["cost_cap_usd"] == cfg.limits.evals.max_cost_usd == 10
    assert report.meta["stopped_reason"] is None
