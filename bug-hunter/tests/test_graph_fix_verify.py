"""Chunk 06 safety and verification pieces, offline: fix-mode write rules, the
baseline cache, new-failure comparison, repro hashes, and the verify node."""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from bug_hunter.context.scratchpad import Scratchpad
from bug_hunter.graph import baseline as bl
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.nodes.verify import make_verify_node, web_projects
from bug_hunter.graph.state import BugState, Finding, Patch, Repro, Signal
from bug_hunter.graph.tools import fix_edit_tool
from bug_hunter.graph.verify import check_passes, hashes_for, hashes_match, new_failures
from bug_hunter.safety.paths import PathDenied
from bug_hunter.tools.fs import Workspace
from bug_hunter.tools.git import Git
from tests.fakes import run_result


def _git(cwd: Path, *args: str) -> str:
    return subprocess.run(
        ["git", "-c", "user.name=t", "-c", "user.email=t@t", *args],
        cwd=cwd,
        check=True,
        capture_output=True,
        text=True,
    ).stdout.strip()


@pytest.fixture
def repo(config, tmp_path: Path):
    root = tmp_path / "wt"
    (root / "ally-be/src/auth").mkdir(parents=True)
    (root / "ally-be/package-lock.json").write_text("{}")
    (root / "ally-be/package.json").write_text("{}")
    (root / "ally-be/jest.config.ts").write_text("export default {};\n")
    (root / "ally-be/src/x.ts").write_text("export const x = () => 0;\n")
    (root / "ally-be/src/auth/guard.ts").write_text("export const g = 1;\n")
    (root / "ally-be/src/x.spec.ts").write_text("it('old', () => {});\n")
    _git(root, "init", "-q", "-b", "master")
    _git(root, "add", ".")
    _git(root, "commit", "-qm", "init")
    return root


def _deps(config, root, tmp_path, runner=None) -> GraphDeps:
    cfg = config.model_copy(update={"repo_root": root})
    return GraphDeps(
        config=cfg,
        run_id="r",
        app="ally-be",
        mode="issue",
        worktree=root,
        app_root=root / "ally-be",
        workspace=Workspace(root, cfg, "ally-be"),
        models={},
        scratchpad=Scratchpad(tmp_path / "pad.md"),
        write_artefact=lambda n, c: (tmp_path / n).write_text(c) or tmp_path / n,
        git=Git(root),
        runner=runner,
    )


def test_fix_edit_refuses_tests_config_risk_and_repro_files(
    config, repo, tmp_path
) -> None:
    deps = _deps(config, repo, tmp_path)
    (repo / "ally-be/src/x.repro.spec.ts").write_text("it('repro', () => {});\n")
    edit = fix_edit_tool(deps, protected=["src/x.repro.spec.ts"])
    for path, why in (
        ("src/x.spec.ts", "tests"),
        ("src/x.repro.spec.ts", "tests"),  # also a test path; protected either way
        ("jest.config.ts", "configuration"),
        ("package.json", "configuration"),
        ("src/auth/guard.ts", "risk path"),
    ):
        out = edit.invoke({"path": path, "old_str": "x", "new_str": "y"})
        assert "error" in out and why in out, (path, out)
    # the one thing it may do: edit a plain source file, exact single match
    assert (
        edit.invoke({"path": "src/x.ts", "old_str": "=> 0", "new_str": "=> 3"})
        == "edited src/x.ts"
    )
    assert (repo / "ally-be/src/x.ts").read_text() == "export const x = () => 3;\n"
    with pytest.raises(PathDenied):
        deps.workspace.policy.check_fix_write(repo / "ally-be/src/x.spec.ts", "ally-be")


def test_baseline_cache_is_shared_by_commit_app_and_command(tmp_path) -> None:
    root = tmp_path / "cache"
    calls = []

    def run():
        calls.append(1)
        return run_result("ally-be", False, "● a › fails")

    first, cached = bl.baseline_for(
        "abc123def456", "ally-be", "npm test", run, root=root
    )
    assert not cached and calls == [1] and first.failing_tests == ["x › fails"]
    second, cached = bl.baseline_for(
        "abc123def456", "ally-be", "npm test", run, root=root
    )
    assert cached and calls == [1] and second.failing_tests == first.failing_tests
    other, cached = bl.baseline_for(
        "abc123def456", "ally-be", "npm run lint", run, root=root
    )
    assert not cached and len(calls) == 2
    assert (
        bl.cache_path("abc123def456", "ally-be", "npm test", root).parent
        == root / "ally-be"
    )


def test_new_failures_ignore_pre_existing_and_repro(tmp_path) -> None:
    base = bl.Baseline(
        "c", "ally-be", "npm test", False, ["old › flaky"], False, 1.0, "t"
    )
    after = run_result("ally-be", False, "")
    after = after.__class__(
        **{**after.__dict__, "failing_tests": ["old › flaky", "new › broken", "repro"]}
    )
    assert new_failures(after, base, ignore={"repro"}) == ["new › broken"]
    same = after.__class__(**{**after.__dict__, "failing_tests": ["old › flaky"]})
    assert new_failures(same, base, ignore=set()) == []
    ok = run_result("ally-be", True)
    assert new_failures(ok, base, ignore=set()) == []
    crash = after.__class__(**{**after.__dict__, "failing_tests": []})
    green_base = bl.Baseline("c", "ally-be", "npm test", True, [], False, 1.0, "t")
    assert (
        new_failures(crash, green_base, ignore=set())
        and "without a parsable" in new_failures(crash, green_base, set())[0]
    )
    assert check_passes(
        run_result("ally-be", False, "lint"),
        bl.Baseline("c", "a", "lint", False, [], False, 1, "t"),
    )
    assert not check_passes(run_result("ally-be", False, "lint"), green_base)
    assert check_passes(run_result("ally-be", False, "lint"), None) is False


def test_repro_hashes_detect_edits(repo) -> None:
    app = repo / "ally-be"
    hashes = hashes_for(app, ["src/x.spec.ts"])
    assert set(hashes) == {"src/x.spec.ts"} and hashes_match(app, hashes)
    (app / "src/x.spec.ts").write_text("it('old', () => { expect(1).toBe(1); });\n")
    assert not hashes_match(app, hashes)


class VerifyRunner:
    """Scripted per command; records what ran so the baseline stash is observable."""

    def __init__(self, repo: Path, results: dict[str, list]):
        self.app = "ally-be"
        self.repo = repo
        self.results = results
        self.calls = []
        self.x_at_call: list[str] = []

    def _take(self, key):
        self.calls.append(key)
        self.x_at_call.append((self.repo / "ally-be/src/x.ts").read_text().strip())
        seq = self.results[key]
        return seq.pop(0) if len(seq) > 1 else seq[0]

    def run_tests(self, target=None, name=None):
        return self._take(("repro", target, name))

    def run_tests_command(self, command):
        return self._take(("suite", command))

    def run_format(self, command):
        self.calls.append(("format", command))
        return run_result("ally-be", True)

    def run_lint(self):
        return self._take(("lint",))

    def run_typecheck(self):
        return self._take(("typecheck",))


def _state(repo) -> BugState:
    return BugState(
        run_id="r",
        signal=Signal(source="issue", ref="1", raw_summary="x", reported_by="staff"),
        app="ally-be",
        started_at="",
        attempts=1,
        finding=Finding(
            app="ally-be", title="t", category="logic", severity="low", hypothesis="h"
        ),
        repro=Repro(
            test_path="src/x.repro.spec.ts",
            test_name="repro",
            command="c",
            failing_output_excerpt="",
            fails_for_the_right_reason=True,
            file_hashes=hashes_for(repo / "ally-be", ["src/x.repro.spec.ts"]),
        ),
        patch=Patch(
            branch="b",
            diff_path="p",
            files_changed=["ally-be/src/x.ts"],
            lines_changed=1,
            rationale="r",
        ),
    )


def test_verify_runs_baseline_on_untouched_code_and_blames_only_new_failures(
    config, repo, tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(bl, "BASELINE_DIR", tmp_path / "bcache")
    (repo / "ally-be/src/x.repro.spec.ts").write_text("it('repro', () => {});\n")
    state = _state(repo)
    (repo / "ally-be/src/x.ts").write_text("export const x = () => 3;\n")  # the fix
    suite_after = run_result("ally-be", False, "")
    suite_after = suite_after.__class__(
        **{
            **suite_after.__dict__,
            "command": "npm test -- --forceExit --detectOpenHandles",
            "failing_tests": ["old › flaky"],
        }
    )
    suite_base = suite_after.__class__(**{**suite_after.__dict__})
    runner = VerifyRunner(
        repo,
        {
            ("repro", "src/x.repro.spec.ts", "repro"): [run_result("ally-be", True)],
            ("suite", "npm test -- --forceExit --detectOpenHandles"): [
                suite_after,
                suite_base,
            ],
            ("lint",): [run_result("ally-be", True)],
            ("typecheck",): [run_result("ally-be", True)],
        },
    )
    deps = _deps(config, repo, tmp_path, runner)
    out = make_verify_node(deps)(state)
    v = out["verification"]
    assert v.passed and out["status"] == "verified", v.summary
    assert v.baseline_failures == ["old › flaky"] and v.new_failures == []
    # the baseline (second suite call) saw the untouched code; then the fix came back
    # calls: repro, format, suite (after), suite baseline (patch stashed), lint, types
    # x_at_call is recorded by the test-side calls only (format is not one of them)
    assert runner.x_at_call[1] == "export const x = () => 3;"  # after
    assert runner.x_at_call[2] == "export const x = () => 0;"  # baseline: patch stashed
    assert (repo / "ally-be/src/x.ts").read_text() == "export const x = () => 3;\n"
    # second verify: the baseline comes from the cache, no extra suite run
    runner.results[("suite", "npm test -- --forceExit --detectOpenHandles")] = [
        suite_after
    ]
    calls_before = len(runner.calls)
    make_verify_node(deps)(state)
    # repro, format, suite, lint, typecheck; no baseline this time
    assert len(runner.calls) == calls_before + 5


def test_verify_fails_on_new_failure_or_edited_repro(
    config, repo, tmp_path, monkeypatch
) -> None:
    monkeypatch.setattr(bl, "BASELINE_DIR", tmp_path / "bcache")
    (repo / "ally-be/src/x.repro.spec.ts").write_text("it('repro', () => {});\n")
    state = _state(repo)
    (repo / "ally-be/src/x.ts").write_text("export const x = () => 3;\n")
    cmd = "npm test -- --forceExit --detectOpenHandles"
    broken = run_result("ally-be", False, "")
    broken = broken.__class__(
        **{**broken.__dict__, "command": cmd, "failing_tests": ["other › now broken"]}
    )
    green = run_result("ally-be", True)
    green = green.__class__(**{**green.__dict__, "command": cmd})
    runner = VerifyRunner(
        repo,
        {
            ("repro", "src/x.repro.spec.ts", "repro"): [run_result("ally-be", True)],
            ("suite", cmd): [broken, green],
            ("lint",): [run_result("ally-be", True)],
            ("typecheck",): [run_result("ally-be", True)],
        },
    )
    out = make_verify_node(_deps(config, repo, tmp_path, runner))(state)
    assert out["status"] == "fixing" and out["verification"].new_failures == [
        "other › now broken"
    ]
    # editing the repro test is caught even if everything is green
    (repo / "ally-be/src/x.repro.spec.ts").write_text(
        "it('repro', () => { /* loosened */ });\n"
    )
    runner = VerifyRunner(
        repo,
        {
            ("repro", "src/x.repro.spec.ts", "repro"): [run_result("ally-be", True)],
            ("suite", cmd): [green, green],
            ("lint",): [run_result("ally-be", True)],
            ("typecheck",): [run_result("ally-be", True)],
        },
    )
    out = make_verify_node(_deps(config, repo, tmp_path, runner))(state)
    assert out["status"] == "fixing" and not out["verification"].repro_files_unchanged


def test_web_projects_from_patch_files() -> None:
    assert web_projects(
        [
            "apps/ally-admin-dashboard/src/a.tsx",
            "apps/ally-admin-dashboard/src/b.ts",
            "libs/ui-shared/src/c.ts",
            "README.md",
        ]
    ) == ["ally-admin-dashboard", "ui-shared"]
