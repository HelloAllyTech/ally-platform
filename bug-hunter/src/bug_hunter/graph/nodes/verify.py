"""Run the repro test, the app's checks and compare with the baseline. No model.

The baseline (failures on the untouched code) is cached per commit, app and command
and shared across runs; on a miss the fix's files are stashed, the command runs, and
the stash is restored, so the baseline never sees the patch.
"""

from __future__ import annotations

from contextlib import contextmanager
from typing import Any, Callable, Iterator

from bug_hunter.graph.baseline import Baseline, baseline_for
from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.state import BugState, Verification
from bug_hunter.graph.verify import check_passes, hashes_match, new_failures
from bug_hunter.tools.runner import RunResult, nx_project


def web_projects(files: list[str]) -> list[str]:
    seen: list[str] = []
    for f in files:
        try:
            project = nx_project(f)
        except Exception:  # noqa: BLE001 - not an apps/libs path
            continue
        if project not in seen:
            seen.append(project)
    return seen


@contextmanager
def patch_removed(deps: GraphDeps, files: list[str]) -> Iterator[None]:
    """The worktree without the fix (tracked edits stashed), restored afterwards."""
    stashed = bool(deps.git and deps.git.stash_paths(deps.worktree, files))
    try:
        yield
    finally:
        if stashed and deps.git:
            deps.git.unstash(deps.worktree)


def make_verify_node(deps: GraphDeps):
    app_config = deps.config.app(deps.app)

    def verify(state: BugState) -> dict[str, Any]:
        assert state.repro is not None and state.patch is not None
        runner = deps.runner
        budget = with_clock(state.budget_used, state.started_at)
        if runner is None:
            return {
                "status": "escalated",
                "stop_reason": "verify: no sandbox available",
                "budget_used": budget,
            }
        deps.ensure_sandbox()
        commit = deps.git.head(deps.worktree) if deps.git else (state.ref or "unknown")
        patch_files = [
            f[len(app_config.path) + 1 :] if f.startswith(app_config.path + "/") else f
            for f in state.patch.files_changed
        ]
        commands: list[str] = []
        ignore = {state.repro.test_name, state.repro.test_path}

        def baseline(command: str, kind_run: Callable[[], RunResult]) -> Baseline:
            def on_untouched_code() -> RunResult:
                files = state.patch.files_changed  # type: ignore[union-attr]
                with patch_removed(deps, files):
                    return kind_run()

            base, _cached = baseline_for(commit, deps.app, command, on_untouched_code)
            return base

        # 1. the reproduction must pass now, and be the file reproduce wrote
        repro_result = runner.run_tests(state.repro.test_path, state.repro.test_name)
        commands.append(repro_result.command)
        unchanged = hashes_match(deps.app_root, state.repro.file_hashes)

        # 2. app tests: touched Nx projects for ally-web, the whole suite elsewhere
        suite_new: list[str] = []
        suite_baseline: list[str] = []
        suite_ok = True
        if app_config.test_project:
            suite_commands = [
                app_config.test_project.format(project=p)
                for p in web_projects(patch_files)
            ]
        else:
            suite_commands = [app_config.test]
        for command in suite_commands:
            after = runner.run_tests_command(command)
            commands.append(after.command)
            base = baseline(command, lambda c=command: runner.run_tests_command(c))
            suite_baseline += base.failing_tests
            fresh = new_failures(after, base, ignore)
            if fresh:
                suite_ok = False
                suite_new += fresh

        # 3. lint and typecheck, blamed only when the untouched code passed
        lint = runner.run_lint()
        lint_base = None
        if not lint.skipped and not lint.passed:
            lint_base = baseline(lint.command, runner.run_lint)
        types = runner.run_typecheck()
        types_base = None
        if not types.skipped and not types.passed:
            types_base = baseline(types.command, runner.run_typecheck)
        commands += [c for c in (lint.command, types.command) if c]

        lint_ok = check_passes(lint, lint_base)
        types_ok = check_passes(types, types_base)
        verification = Verification(
            repro_passes=repro_result.passed,
            app_tests_pass=suite_ok,
            lint_pass=lint_ok,
            typecheck_pass=types_ok,
            new_failures=suite_new,
            baseline_failures=sorted(set(suite_baseline))[:50],
            repro_files_unchanged=unchanged,
            commands_run=commands,
            summary=(
                f"repro {'passes' if repro_result.passed else 'still fails'}; "
                f"{len(suite_new)} new failure(s); lint {'ok' if lint_ok else 'FAIL'}; "
                f"typecheck {'ok' if types_ok else 'FAIL'}; repro files "
                f"{'unchanged' if unchanged else 'CHANGED'}"
            ),
        )
        deps.scratchpad.append_note(
            f"verify (attempt {state.attempts}): {verification.summary}"
        )
        detail = ""
        if not repro_result.passed:
            detail += f"--- repro ---\n{(repro_result.excerpt or '')[-2000:]}\n"
        if suite_new:
            detail += "--- new failures ---\n" + "\n".join(suite_new[:20]) + "\n"
        if not unchanged:
            detail += "--- the reproduction test file was modified ---\n"
        deps.write_artefact(
            f"verify-attempt-{state.attempts}.md",
            verification.summary + "\n\n" + detail,
        )
        return {
            "verification": verification,
            "status": "verified" if verification.passed else "fixing",
            "budget_used": budget,
        }

    return verify
