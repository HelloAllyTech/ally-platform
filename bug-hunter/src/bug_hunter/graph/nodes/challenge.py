"""challenge: run the reviewer's counterexamples (review.v4). Code first, no opinions.

1. New counterexamples are written next to the reproduction test (code picks the file
   name; the workspace's test-path and deny rules apply) and run on the **buggy** code,
   in a clean checkout of the base commit. A test is kept only if it fails genuinely
   (``classify_failure``: not a pass, an empty run or a setup failure) **and** the
   right-reason judge (model, as in reproduce) says the failure is the reported problem.
2. Every kept, undisputed counterexample runs against the current fix. A genuine
   failure sends the fix back (``status: fixing``; the fix node counts the attempt);
   out of attempts, the run escalates with the failing tests.
3. Counterexample files never stay in the fix's worktree: written, run, deleted.
"""

from __future__ import annotations

import re
from pathlib import PurePosixPath
from typing import Any, Callable

from langchain_core.messages import HumanMessage, SystemMessage

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.failure import classify_failure, describe
from bug_hunter.graph.llm import StructuredOutputError, call_structured
from bug_hunter.graph.nodes.common import charge_all, over_budget
from bug_hunter.graph.nodes.reproduce import RightReasonJudgement
from bug_hunter.graph.state import BugState, Counterexample
from bug_hunter.safety.phi import scrub_code
from bug_hunter.tools.runner import RunResult

EXCERPT_MAX = 2000

JUDGE_SYSTEM = (
    "You judge whether a reviewer's test, failing on the ORIGINAL (unfixed) code, "
    "demonstrates the problem the user reported. Say related=true only when the "
    "failing assertion is about the reported symptom, or another input of the same "
    "class the report and finding describe, and the expected value agrees with what "
    "the report says should happen. Say related=false for setup failures (import, "
    "module, fixture, mock, compile, timeout), assertions about unrelated behaviour, "
    "style or naming, or an expected value the report does not support."
)


def counterexample_path(repro_path: str, n: int) -> str:
    """A new test file next to the reproduction test, in the same naming convention:
    ``x.repro.spec.ts`` -> ``x.ce1.spec.ts``, ``test_x.py`` -> ``test_x_ce1.py``,
    ``x_test.dart`` -> ``x_ce1_test.dart``."""
    p = PurePosixPath(repro_path)
    name = p.name
    if name.endswith("_test.dart"):
        new = name[: -len("_test.dart")] + f"_ce{n}_test.dart"
    elif name.endswith(".py"):
        new = name[: -len(".py")] + f"_ce{n}.py"
    else:
        stem, _, rest = name.partition(".")
        rest = re.sub(r"^(?:repro|bughunter)\.", "", rest)
        new = f"{stem}.ce{n}.{rest}" if rest else f"{stem}_ce{n}"
    return str(p.with_name(new))


def _excerpt(result: RunResult) -> str:
    return (result.excerpt or "")[-EXCERPT_MAX:]


def make_challenge_node(deps: GraphDeps):
    app_config = deps.config.app(deps.app)

    def remove(rel: str) -> None:
        (deps.app_root / rel).unlink(missing_ok=True)

    def run_in_worktree(ce: Counterexample) -> RunResult:
        target = deps.app_root / ce.test_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(ce.code, encoding="utf-8")
        try:
            return deps.runner.run_tests(ce.test_path, ce.test_name)
        finally:
            remove(ce.test_path)

    def run_on_buggy_code(
        tests: list[Counterexample],
    ) -> dict[str, RunResult]:
        """All new tests in one clean checkout of the base commit."""
        assert deps.git is not None
        commit = deps.git.head(deps.worktree)
        app_rel = deps.app_root.relative_to(deps.worktree)
        results: dict[str, RunResult] = {}
        with deps.git.clean_checkout(
            deps.worktree.parent, "challenge", commit
        ) as clean:
            for ce in tests:
                target = clean / app_rel / ce.test_path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(ce.code, encoding="utf-8")
            runner = deps.make_baseline_runner(clean, clean / app_rel)
            try:
                for ce in tests:
                    results[ce.name] = runner.run_tests(ce.test_path, ce.test_name)
            finally:
                cleanup = getattr(getattr(runner, "sandbox", None), "cleanup", None)
                if cleanup:
                    cleanup()
        return results

    def judge(state: BugState, ce: Counterexample, excerpt: str, charge: Callable):
        user = (
            f"The user's report (scrubbed):\n{state.signal.raw_summary}\n\n"
            f"Finding: {state.finding.title if state.finding else ''}\n"
            f"{state.finding.hypothesis if state.finding else ''}\n\n"
            f"The reviewer's claim:\n{ce.claim}\n\nThe test:\n{ce.code[-4000:]}\n\n"
            f"Its output on the original code (scrubbed, tail):\n{excerpt}"
        )
        try:
            verdict, raws, secs = call_structured(
                deps.model("fix"),
                RightReasonJudgement,
                [SystemMessage(content=JUDGE_SYSTEM), HumanMessage(content=user)],
            )
            charge(raws, secs)
            return verdict.related, verdict.why
        except StructuredOutputError as exc:
            return False, f"judgement failed: {exc}"[:300]

    def challenge(state: BugState) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        assert state.repro is not None and state.review is not None
        budget = with_clock(state.budget_used, state.started_at)
        if deps.runner is None or deps.git is None:
            return {
                "status": "escalated",
                "stop_reason": "challenge: no sandbox to run counterexamples",
                "budget_used": budget,
            }
        deps.ensure_sandbox()
        holder = {"budget": budget}

        def charge(raws, secs) -> None:
            holder["budget"] = charge_all(
                deps, holder["budget"], "challenge", "fix", raws, secs
            )

        tests = [ce.model_copy() for ce in state.counterexamples]
        # 1. the reviewer's new proposals for this attempt
        fresh: list[Counterexample] = []
        if state.review.verdict == "counterexamples":
            for proposed in state.review.counterexamples:
                n = len(tests) + 1
                ce = Counterexample(
                    name=f"ce{n}",
                    test_path=counterexample_path(state.repro.test_path, n),
                    test_name=proposed.test_name.strip(),
                    code=scrub_code(proposed.code),
                    claim=proposed.claim.strip()[:300],
                    proposed_at_attempt=state.attempts,
                )
                tests.append(ce)
                try:  # path rules (test location, deny paths) via the workspace
                    deps.workspace.write_test_file(ce.test_path, ce.code)
                    remove(ce.test_path)
                except Exception as exc:  # noqa: BLE001 - FsError / policy errors
                    ce.status, ce.reason = "dropped", f"bad shape: {exc}"[:300]
                    continue
                if not ce.test_name:
                    ce.status, ce.reason = "dropped", "bad shape: no test name"
                    continue
                fresh.append(ce)
        if fresh:
            before = run_on_buggy_code(fresh)
            for ce in fresh:
                result = before[ce.name]
                kind = classify_failure(app_config, result)
                ce.failure_excerpt = _excerpt(result)
                if kind != "genuine":
                    ce.status = "dropped"
                    ce.reason = f"on the buggy code: {describe(kind)}"
                    continue
                related, why = judge(state, ce, ce.failure_excerpt, charge)
                if not related:
                    ce.status, ce.reason = "dropped", f"wrong reason: {why}"[:300]
                    continue
                ce.status, ce.reason = "kept", why[:300]
        # 2. every kept, undisputed counterexample against the current fix
        failing: list[Counterexample] = []
        for ce in tests:
            if ce.status not in ("kept", "passed", "failed"):
                continue
            result = run_in_worktree(ce)
            if result.passed and not result.no_tests:
                ce.status = "passed"
            else:
                ce.status = "failed"
                ce.failed_on_fix += 1
                ce.failure_excerpt = _excerpt(result)
                failing.append(ce)
        summary = ", ".join(f"{ce.name}={ce.status}" for ce in tests) or "none"
        deps.scratchpad.append_note(f"challenge (attempt {state.attempts}): {summary}")
        deps.write_artefact(
            f"challenge-attempt-{state.attempts}.md",
            "\n\n".join(
                f"## {ce.name} · {ce.status}\n`{ce.test_path}::{ce.test_name}`\n"
                f"claim: {ce.claim}\nreason: {ce.reason}\n\n```\n{ce.code}\n```"
                + (
                    f"\n\noutput:\n```\n{ce.failure_excerpt}\n```"
                    if ce.failure_excerpt
                    else ""
                )
                for ce in tests
            )
            or "no counterexamples",
        )
        update: dict[str, Any] = {
            "counterexamples": tests,
            "budget_used": with_clock(holder["budget"], state.started_at),
        }
        if not failing:
            update["status"] = "reviewed"
            return update
        if state.attempts >= deps.config.limits.run.max_fix_attempts:
            update["status"] = "escalated"
            update["stop_reason"] = (
                f"reviewer counterexamples still fail after {state.attempts} "
                "attempts: " + "; ".join(f"{ce.name}: {ce.claim}" for ce in failing)
            )[:400]
            return update
        update["status"] = "fixing"
        return update

    return challenge
