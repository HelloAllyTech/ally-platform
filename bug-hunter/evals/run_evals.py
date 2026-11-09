"""Run the golden cases against an agent, one case at a time, each inside a ``Run``
(worktree removed afterwards, artefacts kept). A disk guard stops the harness
cleanly below ``limits.evals.min_free_gb``.

Worktree ref: a bug case checks out ``parent`` (bug present); a clean case checks
out ``commit`` (the clean change applied). Sweep input is that commit's own diff;
issue input is the case description.

Scoring is code, not judgement: a patch is applied with ``git apply`` and the hidden
oracle tests run in the sandbox; a reproduction test is valid only if it fails on the
buggy code. ``--oracle-check`` instead applies the case's real fix and requires the
oracle to fail before and pass after, proving the case itself.
"""

from __future__ import annotations

import json
import shutil
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from bug_hunter.config import PACKAGE_ROOT, RUNS_DIR, BugHunterConfig
from bug_hunter.runs import Run
from bug_hunter.safety.phi import scrub_code
from bug_hunter.tools.git import GitError
from bug_hunter.tools.runner import Runner, RunResult
from bug_hunter.tools.sandbox import DockerRunner, Sandbox, subprocess_docker
from evals.agents import Agent, AgentResult, CaseInput
from evals.metrics import CaseResult, aggregate, render_markdown
from evals.mine_cases import APP_PATH_ALIASES, Repo
from evals.schema import Case

RESULTS_DIR = PACKAGE_ROOT / "evals" / "results"
ORACLE_STATUS = PACKAGE_ROOT / "evals" / "golden" / "oracle-status.json"
CANDIDATES_DIR = PACKAGE_ROOT / "evals" / "golden" / "candidates"


class StopHarness(RuntimeError):
    """Raised between cases when the disk guard trips; the report is still written."""


class DiskGuard:
    def __init__(self, min_free_gb: float, probe: Callable[[], float] | None = None):
        self.min_free_gb = min_free_gb
        self.probe = probe or (lambda: shutil.disk_usage(RUNS_DIR.parent).free / 1e9)

    def free_gb(self) -> float:
        return round(self.probe(), 2)

    def check(self, where: str) -> None:
        free = self.free_gb()
        if free < self.min_free_gb:
            raise StopHarness(f"free disk {free} GB < {self.min_free_gb} GB ({where})")


@dataclass
class HarnessOptions:
    mode: str = "issue"  # sweep | issue
    oracle_check: bool = False
    dry_run: bool = False
    min_free_gb: float | None = None
    docker: DockerRunner = subprocess_docker
    sandbox_factory: Callable[..., Sandbox] | None = None  # tests inject a fake


@dataclass
class Report:
    meta: dict[str, Any]
    cases: list[CaseResult] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "meta": self.meta,
            "metrics": {k: m.to_dict() for k, m in aggregate(self.cases).items()},
            "cases": [c.to_dict() for c in self.cases],
        }


# --- per-case ----


def worktree_ref(case: Case) -> str:
    return case.parent if case.kind == "bug" else case.commit


def app_root_for(repo: Repo, case: Case, app_path: str) -> str | None:
    """Where the app lives in a worktree at the case's ref: ``app_path`` (monorepo),
    ``""`` (old root layout), or None if it is not there at all."""
    ref = worktree_ref(case)
    if case.layout == "root":
        return (
            ""
            if repo.git(
                "ls-tree", ref, "--", case.src_files[0] if case.src_files else "."
            ).strip()
            else None
        )
    if repo.git("ls-tree", "-d", ref, "--", app_path).strip():
        return app_path
    for alias, app in APP_PATH_ALIASES.items():
        if app == app_path and repo.git("ls-tree", "-d", ref, "--", alias).strip():
            return alias
    return None


def case_repo_paths(case: Case, app_path: str, rels: list[str]) -> list[str]:
    return [f"{app_path}/{r}" if case.layout == "monorepo" else r for r in rels]


def _run_tests(runner: Runner, tests: list[str]) -> tuple[bool, float, list[RunResult]]:
    results = [runner.run_tests(test) for test in tests]
    return all(r.passed for r in results), sum(r.duration_s for r in results), results


def score_bug(case: Case, result: AgentResult) -> str:
    if result.escalated:
        return "escalated_correctly" if case.expected == "escalate" else "escalated"
    return "detected" if result.found else "missed"


def score_clean(result: AgentResult) -> str:
    return "false_alarm" if (result.found or result.escalated) else "clean"


def run_case(
    config: BugHunterConfig,
    case: Case,
    agent: Agent,
    options: HarnessOptions,
    guard: DiskGuard,
    repo: Repo,
) -> CaseResult:
    ref = worktree_ref(case)
    app_path = config.app(case.app).path
    started = time.monotonic()
    sandbox_seconds = 0.0
    location = app_root_for(repo, case, app_path)
    if location is None or location not in (app_path, ""):
        why = (
            "app directory absent at this commit"
            if location is None
            else f"app lived at {location}/ at this commit"
        )
        return CaseResult(
            case.id,
            case.app,
            case.kind,
            case.expected,
            "error",
            error=f"not runnable in the sandbox: {why}",
        )
        return CaseResult(
            case.id,
            case.app,
            case.kind,
            case.expected,
            "error",
            error=f"not runnable in the sandbox: {why}",
        )
    with Run.start(
        config, case.app, ref, runs_dir=RUNS_DIR, docker=options.docker
    ) as run:
        result_row = CaseResult(
            case.id, case.app, case.kind, case.expected, "error", run_id=run.run_id
        )
        try:
            run.write_artefact("case.json", json.dumps(case.model_dump(), indent=1))
            app_root = (
                run.worktree if case.layout == "root" else run.worktree / app_path
            )
            sandbox = (options.sandbox_factory or Sandbox)(
                config,
                run.worktree,
                case.app,
                run.run_id,
                docker=options.docker,
                app_root=app_root,
            )
            run.sandbox = sandbox
            runner = Runner(config, sandbox)
            diff = (
                scrub_code(repo.git("show", "--format=", case.commit))
                if options.mode == "sweep"
                else ""
            )
            case_input = CaseInput(
                case,
                options.mode,
                case.app,
                run.worktree,
                app_root=app_root,
                diff=diff,
                description=case.description,
            )

            if options.oracle_check:
                return _oracle_check(
                    config, case, run, runner, sandbox, guard, repo, result_row, started
                )

            t0 = time.monotonic()
            agent_result = agent.run(case_input, run)
            agent_seconds = time.monotonic() - t0
            result_row.found, result_row.escalated = (
                agent_result.found,
                agent_result.escalated,
            )
            result_row.tokens, result_row.cost_usd = (
                agent_result.tokens,
                agent_result.cost_usd,
            )
            run.write_artefact(
                "agent-result.json",
                json.dumps(
                    {k: v for k, v in agent_result.__dict__.items() if k != "patch"},
                    indent=1,
                    default=str,
                ),
            )
            if agent_result.patch:
                run.write_artefact("agent.patch", agent_result.patch)

            if case.kind == "clean":
                result_row.outcome = score_clean(agent_result)
            else:
                result_row.outcome = score_bug(case, agent_result)
                needs_sandbox = agent_result.repro_test is not None or (
                    agent_result.patch and not agent_result.escalated
                )
                if needs_sandbox:
                    sandbox.ensure_image()
                    sandbox.install()
                    guard.check(f"after install for {case.id}")
                if agent_result.repro_test is not None:
                    path, content = agent_result.repro_test
                    target = app_root / path
                    target.parent.mkdir(parents=True, exist_ok=True)
                    target.write_text(content, encoding="utf-8")
                    passed, secs, _ = _run_tests(runner, [path])
                    sandbox_seconds += secs
                    result_row.repro_valid = not passed  # must fail on the buggy code
                if agent_result.patch and not agent_result.escalated:
                    result_row.patch_applied = _apply_patch(run, agent_result.patch)
                    if result_row.patch_applied:
                        _add_oracle_tests(run, repo, case, app_path)  # hidden until now
                        passed, secs, _ = _run_tests(runner, case.oracle_tests)
                        sandbox_seconds += secs
                        result_row.oracle_pass = passed
                    else:
                        result_row.oracle_pass = False
            result_row.seconds = round(agent_seconds, 1)
        except StopHarness:
            raise
        except (
            Exception
        ) as exc:  # noqa: BLE001 - one broken case must not stop the batch
            result_row.outcome = "error"
            result_row.error = f"{type(exc).__name__}: {exc}"[:500]
        result_row.sandbox_seconds = round(sandbox_seconds, 1)
        run.write_artefact("result.json", json.dumps(result_row.to_dict(), indent=1))
        return result_row


def _add_oracle_tests(run: Run, repo: Repo, case: Case, app_path: str) -> bool:
    """Bring the fix commit's test files (the oracle) into the worktree."""
    paths = case_repo_paths(case, app_path, case.oracle_tests)
    test_patch = repo.git("show", "--format=", case.commit, "--", *paths)
    if not test_patch.strip():
        return True
    return _apply_patch(run, test_patch, name="oracle-tests.patch")


def _apply_patch(run: Run, patch: str, name: str = "agent.patch") -> bool:
    patch_file = run.write_artefact("agent.patch", patch)
    try:
        run.git._git(
            ["apply", "--whitespace=nowarn", str(patch_file)], cwd=run.worktree
        )
        return True
    except GitError:
        return False


def _oracle_check(
    config, case, run, runner, sandbox, guard, repo, row, started
) -> CaseResult:
    """Prove the case: oracle fails at parent, passes with the real fix applied."""
    sandbox.ensure_image()
    sandbox.install()
    guard.check(f"after install for {case.id}")
    patch_path = CANDIDATES_DIR / f"{case.id}.patch"
    patch = (
        patch_path.read_text(encoding="utf-8")
        if patch_path.exists()
        else repo.diff(case.commit, [])
    )
    if not patch.strip():
        patch = repo.git("show", "--format=", case.commit)
    sandbox_seconds = 0.0
    # the oracle test files must exist to run "before": add only the test files first
    test_patch = repo.git(
        "show",
        "--format=",
        case.commit,
        "--",
        *[f"{config.app(case.app).path}/{t}" for t in case.oracle_tests],
    )
    before_ok = _apply_patch(run, test_patch) if test_patch.strip() else True
    passed_before, secs, before = _run_tests(runner, case.oracle_tests)
    sandbox_seconds += secs
    # then the source part of the fix
    src_patch = repo.git(
        "show",
        "--format=",
        case.commit,
        "--",
        *[f"{config.app(case.app).path}/{s}" for s in case.src_files],
    )
    applied = _apply_patch(run, src_patch) if src_patch.strip() else False
    passed_after, secs, after = (
        _run_tests(runner, case.oracle_tests) if applied else (False, 0.0, [])
    )
    sandbox_seconds += secs
    proven = before_ok and applied and (not passed_before) and passed_after
    row.outcome = "oracle_proven" if proven else "oracle_failed"
    row.patch_applied = applied
    row.oracle_pass = passed_after
    row.repro_valid = not passed_before
    row.sandbox_seconds = round(sandbox_seconds, 1)
    row.seconds = round(time.monotonic() - started, 1)
    if not proven:
        detail = (
            f"test_patch_applied={before_ok} fix_applied={applied} "
            f"fails_before={not passed_before} passes_after={passed_after}"
        )
        row.error = (
            detail + " | " + " | ".join(r.summary() for r in before + after)[:400]
        )
    run.write_artefact("oracle-before.md", "\n\n".join(r.excerpt for r in before))
    run.write_artefact("oracle-after.md", "\n\n".join(r.excerpt for r in after))
    _record_oracle(case.id, proven, row.error)
    return row


def _record_oracle(case_id: str, proven: bool, detail: str | None) -> None:
    status = json.loads(ORACLE_STATUS.read_text()) if ORACLE_STATUS.exists() else {}
    status[case_id] = {
        "proven": proven,
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "detail": detail,
    }
    ORACLE_STATUS.parent.mkdir(parents=True, exist_ok=True)
    ORACLE_STATUS.write_text(json.dumps(status, indent=1, sort_keys=True))


# --- batch ----


def plan(config: BugHunterConfig, cases: list[Case]) -> dict[str, Any]:
    """What a run would do: order, distinct lockfiles (= dependency volumes) per app."""
    lockfiles: dict[str, set[str]] = {}
    for c in cases:
        lockfiles.setdefault(c.app, set()).add(c.lockfile_blob or "unknown")
    return {
        "cases": [(c.id, c.kind, worktree_ref(c)[:10]) for c in cases],
        "distinct_lockfiles_per_app": {app: len(v) for app, v in lockfiles.items()},
    }


def run_evals(
    config: BugHunterConfig,
    cases: list[Case],
    agent: Agent,
    options: HarnessOptions,
    repo: Repo | None = None,
    guard: DiskGuard | None = None,
    results_dir: Path = RESULTS_DIR,
) -> tuple[Report, Path | None]:
    repo = repo or Repo(config.repo_root)
    guard = guard or DiskGuard(options.min_free_gb or config.limits.evals.min_free_gb)
    git_sha = repo.git("rev-parse", "HEAD").strip()
    meta = {
        "agent": agent.name,
        "mode": "oracle-check" if options.oracle_check else options.mode,
        "git_sha": git_sha,
        "prompt_versions": "none (chunk 04)",
        "models": {
            role: f"{config.model_for(role).provider}:{config.model_for(role).model}"
            for role in config.models.roles
        },
        "timestamp": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "cases": len(cases),
        "stopped_reason": None,
        "free_gb_start": guard.free_gb(),
    }
    report = Report(meta=meta)
    if options.dry_run:
        meta["plan"] = plan(config, cases)
        return report, None
    try:
        for case in cases:
            guard.check(f"before {case.id}")
            report.cases.append(run_case(config, case, agent, options, guard, repo))
    except StopHarness as exc:
        meta["stopped_reason"] = str(exc)
    meta["free_gb_end"] = guard.free_gb()
    results_dir.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
    base = results_dir / f"{stamp}-{agent.name}-{meta['mode']}-{git_sha[:8]}"
    base.with_suffix(".json").write_text(
        json.dumps(report.to_dict(), indent=1), encoding="utf-8"
    )
    base.with_suffix(".md").write_text(
        render_markdown(report.to_dict()), encoding="utf-8"
    )
    return report, base.with_suffix(".md")
