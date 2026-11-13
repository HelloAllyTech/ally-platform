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


def test_sweep_mode_shows_the_introducing_commit_never_the_fix(
    repo_config, tmp_path: Path
) -> None:
    cfg, repo, bug, _clean = repo_config
    seen: list[str] = []

    class Recorder:
        name = "recorder"

        def run(self, case_input, run) -> AgentResult:
            seen.append(case_input.diff)
            return AgentResult()

    intro = repo.git("rev-parse", bug.parent).strip()  # the feat that added x.ts
    case = bug.model_copy(update={"introduced_by": intro})
    run_evals(
        cfg,
        [
            case,
            bug.model_copy(update={"id": "ally-be-bug00002"}),
        ],  # 2nd: no introduced_by → skipped
        Recorder(),
        _options(mode="sweep"),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert len(seen) == 1
    assert "buggy" in seen[0] and "fixed" not in seen[0]  # the feat diff, not the fix


def test_sweep_diff_scopes_a_mass_commit_to_the_app(
    repo_config, tmp_path: Path
) -> None:
    import subprocess

    from evals.run_evals import sweep_diff

    cfg, repo, bug, _clean = repo_config
    root = cfg.repo_root
    (root / "other").mkdir()
    (root / "other/big.txt").write_text("\n".join(f"line {i}" for i in range(600)))
    (root / "ally-be/src/y.ts").write_text("export const y = 1;\n")
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "add", "."],
        cwd=root,
        check=True,
    )
    subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "mass"],
        cwd=root,
        check=True,
    )
    sha = repo.git("rev-parse", "HEAD").strip()
    diff = sweep_diff(repo, sha, "ally-be")
    assert "y.ts" in diff and "big.txt" not in diff
    small = sweep_diff(repo, bug.commit, "ally-be")
    assert "x.ts" in small


def test_repro_validity_is_measured_with_the_agents_fix_set_aside(
    repo_config, tmp_path: Path
) -> None:
    """A graph agent applies its fix in the worktree; the harness must still see the
    repro fail on the buggy code (it scored every PR case 'repro: no' before)."""
    cfg, repo, bug, _clean = repo_config

    class FixingAgent:
        name = "fixing"

        def run(self, case_input, run) -> AgentResult:
            x = case_input.app_root / "src/x.ts"
            x.write_text(x.read_text().replace("buggy", "fixed"))
            (case_input.app_root / "src/x.repro.spec.ts").write_text("tests src/x.ts\n")
            patch = run.git.diff(run.worktree)
            return AgentResult(
                found=True,
                repro_test=("src/x.repro.spec.ts", "tests src/x.ts\n"),
                patch=patch,
                patch_applied=True,
            )

    report, _ = run_evals(
        cfg,
        [bug],
        FixingAgent(),
        _options(),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    row = report.cases[0]
    assert row.repro_valid is True, row  # failed on the buggy code
    assert row.oracle_pass is True  # and the fix passes the hidden oracle


def test_a_crashed_agent_keeps_its_cost(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, _clean = repo_config

    class CrashingAgent:
        name = "crashing"

        def run(self, case_input, run) -> AgentResult:
            return AgentResult(
                cost_usd=0.45, tokens=900, status="error", error="GitError: x"
            )

    report, _ = run_evals(
        cfg,
        [bug],
        CrashingAgent(),
        _options(max_cost_usd=10),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    row = report.cases[0]
    assert row.outcome == "error" and row.error == "GitError: x"
    assert row.cost_usd == 0.45 and report.meta["cost_usd_total"] == 0.45


def test_holdout_cases_never_run_without_milestone(repo_config, tmp_path: Path) -> None:
    import pytest as _pytest

    cfg, repo, bug, clean = repo_config
    held = bug.model_copy(update={"id": "ally-be-held0001", "split": "holdout"})
    report, _ = run_evals(
        cfg,
        [bug, clean, held],
        BaselineAgent(),
        _options(),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert {c.id for c in report.cases} == {bug.id, clean.id}  # dev only by default
    with _pytest.raises(ValueError, match="milestone"):
        run_evals(
            cfg,
            [held],
            BaselineAgent(),
            _options(split="holdout"),
            repo=repo,
            guard=DiskGuard(5, probe=lambda: 50.0),
            results_dir=tmp_path / "r",
        )
    report, _ = run_evals(
        cfg,
        [bug, held],
        BaselineAgent(),
        _options(split="holdout", milestone=True),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=tmp_path / "r",
    )
    assert [c.id for c in report.cases] == [held.id]
    assert report.meta["split"] == "holdout"


def test_report_is_written_after_every_case(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, clean = repo_config
    seen: list[int] = []
    out = tmp_path / "r"

    class Watching:
        name = "watching"

        def run(self, case_input, run) -> AgentResult:
            files = sorted(out.glob("*.json")) if out.exists() else []
            if files:
                import json as _json

                seen.append(len(_json.loads(files[-1].read_text())["cases"]))
            return AgentResult()

    report, path = run_evals(
        cfg,
        [bug, clean],
        Watching(),
        _options(),
        repo=repo,
        guard=DiskGuard(5, probe=lambda: 50.0),
        results_dir=out,
    )
    assert seen == [1]  # while case 2 ran, case 1 was already on disk
    assert report.meta["partial"] is False and len(list(out.glob("*.json"))) == 1
