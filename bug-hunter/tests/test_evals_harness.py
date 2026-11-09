"""Harness end to end with a fake sandbox and the baseline agent on a temp repo;
disk guard stops cleanly; oracle check proves a case; patches are scored."""

from __future__ import annotations

import json
import subprocess
import tempfile
from pathlib import Path

import pytest

from bug_hunter.config import BugHunterConfig
from bug_hunter.runs import Run
from bug_hunter.tools.sandbox import DockerResult, ExecResult
from evals.agents import AgentResult, BaselineAgent, CaseInput, load_agent
from evals.mine_cases import Repo
from evals.run_evals import DiskGuard, HarnessOptions, plan, run_evals
from evals.schema import Case


class FakeDocker:
    def __call__(self, args, timeout=None):
        return DockerResult(tuple(args), 0, "", "")


class FakeSandbox:
    """Runs the 'tests' on the host by checking file contents: a test file passes
    iff the source file it names contains the string 'fixed'."""

    instances: list = []

    def __init__(self, config, worktree, app, run_id, docker=None, app_root=None):
        self.config, self.worktree, self.app, self.run_id = (
            config,
            Path(worktree),
            app,
            run_id,
        )
        self.app_root = (
            Path(app_root) if app_root else self.worktree / config.app(app).path
        )
        self.installed = False
        FakeSandbox.instances.append(self)

    def ensure_image(self):
        return "fake"

    def install(self, force=False):
        self.installed = True
        return None

    def exec(self, command, **_):
        # command looks like: npx jest <file> --forceExit
        test_file = command.split()[2]
        app_dir = self.app_root
        try:
            src_name = (app_dir / test_file).read_text().strip().split("tests ")[1]
            passed = "fixed" in (app_dir / src_name).read_text()
        except (OSError, IndexError):
            passed = False
        return ExecResult(
            command,
            0 if passed else 1,
            "ok" if passed else f"FAIL {test_file}\n  ● t › fails",
            "",
            0.1,
        )

    def cleanup(self):
        pass


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def repo_config(config: BugHunterConfig, tmp_path: Path):
    """A repo with: buggy commit (parent) → fix commit adding src change + test."""
    root = tmp_path / "repo"
    (root / "ally-be/src").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/src/x.ts").write_text("export const x = 'buggy';\n")
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "feat(be): x")
    parent = _git(root, "rev-parse", "HEAD")
    (root / "ally-be/src/x.ts").write_text("export const x = 'fixed';\n")
    (root / "ally-be/src/x.spec.ts").write_text("tests src/x.ts\n")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "fix(be): x no longer buggy")
    fix = _git(root, "rev-parse", "HEAD")
    cfg = config.model_copy(update={"repo_root": root})
    repo = Repo(root, ref="master")
    bug = Case(
        id="ally-be-bug00001",
        kind="bug",
        app="ally-be",
        parent=parent,
        commit=fix,
        expected="fix",
        description="x is buggy and should be fixed",
        src_files=["src/x.ts"],
        oracle_tests=["src/x.spec.ts"],
    )
    clean = Case(
        id="ally-be-clean0001",
        kind="clean",
        app="ally-be",
        parent=parent,
        commit=fix,
        expected="no_bug",
        description="a clean change that needs no fix",
    )
    return cfg, repo, bug, clean


def _options(**over) -> HarnessOptions:
    base = dict(
        mode="issue",
        docker=FakeDocker(),
        sandbox_factory=FakeSandbox,
        runs_dir=Path(tempfile.mkdtemp(prefix="bh-eval-runs-")),
    )
    base.update(over)
    return HarnessOptions(**base)


def test_baseline_end_to_end_and_report(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, clean = repo_config
    guard = DiskGuard(5, probe=lambda: 50.0)
    report, path = run_evals(
        cfg,
        [bug, clean],
        BaselineAgent(),
        _options(),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "results",
    )
    outcomes = {c.id: c.outcome for c in report.cases}
    assert outcomes == {"ally-be-bug00001": "missed", "ally-be-clean0001": "clean"}
    rates = report.to_dict()["metrics"]["total"]["rates"]
    assert rates["detection"] == 0.0 and rates["false_alarm"] == 0.0
    assert path.exists() and path.with_suffix(".json").exists()
    assert "baseline · issue mode" in path.read_text()
    # every run's worktree is gone; artefacts kept per run
    assert not any(p.name.startswith("run-") for p in (cfg.repo_root.parent).iterdir())
    assert all(c.run_id for c in report.cases)


def test_disk_guard_stops_cleanly_between_cases(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, clean = repo_config
    readings = iter(
        [10.0, 10.0, 4.0, 4.0]
    )  # start, before case 1, before case 2 → stop
    guard = DiskGuard(5, probe=lambda: next(readings, 4.0))
    report, path = run_evals(
        cfg,
        [bug, clean],
        BaselineAgent(),
        _options(),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "results",
    )
    assert len(report.cases) == 1
    assert report.meta["stopped_reason"].startswith("free disk 4.0 GB < 5 GB")
    assert "stopped: free disk" in path.read_text()


class FixingAgent:
    name = "fixing"

    def __init__(self, patch_ok=True, repro=True):
        self.patch_ok, self.repro = patch_ok, repro

    def run(self, case_input: CaseInput, run: Run) -> AgentResult:
        patch = (
            "--- a/ally-be/src/x.ts\n+++ b/ally-be/src/x.ts\n@@ -1 +1 @@\n"
            "-export const x = 'buggy';\n+export const x = 'fixed';\n"
            if self.patch_ok
            else "--- a/ally-be/src/nope.ts\n+++ b/ally-be/src/nope.ts\n"
            "@@ -1 +1 @@\n-a\n+b\n"
        )
        repro = ("src/repro.spec.ts", "tests src/x.ts\n") if self.repro else None
        return AgentResult(
            found=True, patch=patch, repro_test=repro, tokens=100, cost_usd=0.01
        )


def test_patch_and_repro_are_scored_in_the_sandbox(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, clean = repo_config
    guard = DiskGuard(5, probe=lambda: 50.0)
    report, _ = run_evals(
        cfg,
        [bug, clean],
        FixingAgent(),
        _options(),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "r",
    )
    b, c = report.cases
    assert b.outcome == "detected" and b.patch_applied and b.oracle_pass is True
    assert b.repro_valid is True  # the repro test failed on the buggy code
    assert c.outcome == "false_alarm"
    rates = report.to_dict()["metrics"]["total"]["rates"]
    assert rates == {
        "detection": 1.0,
        "false_alarm": 1.0,
        "reproduction": 1.0,
        "fix_pass": 1.0,
        "escalation_correct": None,
        "error": 0.0,
    }
    report, _ = run_evals(
        cfg,
        [bug],
        FixingAgent(patch_ok=False),
        _options(),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "r2",
    )
    assert (
        report.cases[0].patch_applied is False and report.cases[0].oracle_pass is False
    )


def test_oracle_check_proves_a_case(repo_config, tmp_path: Path, monkeypatch) -> None:
    cfg, repo, bug, _clean = repo_config
    status = tmp_path / "oracle-status.json"
    monkeypatch.setattr("evals.run_evals.ORACLE_STATUS", status)
    monkeypatch.setattr("evals.run_evals.CANDIDATES_DIR", tmp_path / "no-candidates")
    guard = DiskGuard(5, probe=lambda: 50.0)
    report, _ = run_evals(
        cfg,
        [bug],
        BaselineAgent(),
        _options(oracle_check=True),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "r",
    )
    row = report.cases[0]
    assert row.outcome == "oracle_proven", row.error
    assert row.repro_valid is True and row.oracle_pass is True and row.patch_applied
    assert json.loads(status.read_text())["ally-be-bug00001"]["proven"] is True
    assert report.meta["mode"] == "oracle-check"


def test_escalation_scoring_and_plan(repo_config, tmp_path: Path) -> None:
    cfg, repo, bug, clean = repo_config
    risky = bug.model_copy(
        update={"id": "ally-be-risk0001", "risk": True, "expected": "escalate"}
    )

    class Escalates:
        name = "escalates"

        def run(self, case_input, run):
            return AgentResult(
                found=True, escalated=True, escalation_reason="risk path"
            )

    guard = DiskGuard(5, probe=lambda: 50.0)
    report, _ = run_evals(
        cfg,
        [risky, bug],
        Escalates(),
        _options(),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "r",
    )
    assert [c.outcome for c in report.cases] == ["escalated_correctly", "escalated"]
    assert report.to_dict()["metrics"]["total"]["rates"]["escalation_correct"] == 1.0
    p = plan(cfg, [bug, clean])
    assert p["distinct_lockfiles_per_app"] == {"ally-be": 1}
    report, path = run_evals(
        cfg,
        [bug],
        BaselineAgent(),
        _options(dry_run=True),
        repo=repo,
        guard=guard,
        results_dir=tmp_path / "r",
    )
    assert path is None and report.meta["plan"]["cases"][0][0] == "ally-be-bug00001"


def test_load_agent() -> None:
    assert isinstance(load_agent("baseline"), BaselineAgent)
    assert load_agent("tests.test_evals_harness:FixingAgent").name == "fixing"
    with pytest.raises(ValueError):
        load_agent("nonsense")
