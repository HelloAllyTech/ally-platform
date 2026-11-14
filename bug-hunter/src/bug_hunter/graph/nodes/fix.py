"""The smallest diff that makes the repro pass: a tool loop over outline-first reads,
a guarded ``edit_file`` and the repro test only. The rules are enforced in code after
the loop as well: diff size, no test edits, no skipped tests."""

from __future__ import annotations

import re
from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.loop import LoopState, ToolLoop, initial_messages, run_loop
from bug_hunter.graph.nodes.common import node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import BugState, Counterexample, Patch
from bug_hunter.graph.tools import (
    fix_edit_tool,
    lint_tool,
    outline_first_read_tools,
    repro_only_run_tests,
)

# a diff line that removes a test or adds a skip: never acceptable in a fix
_REMOVED_TEST = re.compile(
    r"^-\s*(?:it|test|describe|def test_|void test|testWidgets)\b"
)
_ADDED_SKIP = re.compile(
    r"^\+.*(?:\.skip\(|\bxit\(|\bxdescribe\(|\bxtest\(|@pytest\.mark\.skip|"
    r"pytest\.skip\(|\bskip:\s*true|@Skip\()"
)


class SubmitFix(BaseModel):
    """Finish: the reproduction test passes and the change is the smallest one."""

    model_config = ConfigDict(extra="forbid")

    rationale: str = Field(
        description="One or two sentences: what was wrong, what changed"
    )
    files_changed: list[str] = Field(description="App-relative paths you edited")


class GiveUp(BaseModel):
    """Finish: the fix needs a human (risk path, redesign, unclear root cause)."""

    model_config = ConfigDict(extra="forbid")

    reason: str


class DisputeCounterexampleArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="The counterexample's name, e.g. ce1")
    reason: str = Field(
        description="How this test contradicts the report or the finding (quote it)"
    )


class RunCounterexampleArgs(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str = Field(description="The counterexample's name, e.g. ce1")


def _noop(**_: Any) -> str:
    return "ok"


LOWER = {"high": "medium", "medium": "low", "low": "low"}


def lower_confidence(confidence: str | None) -> str:
    return LOWER.get(confidence or "low", "low")


def counterexample_feedback(failing: list[Counterexample]) -> str:
    lines = [
        "The reviewer's counterexamples below still FAIL with your fix. Code checked "
        "each one: it fails on the original code because of the reported problem. "
        "Make them pass too (run them with run_counterexample), unless one contradicts "
        "the report or the finding: then call dispute_counterexample(name, reason) "
        "once for it, quoting the report or finding. A dispute is shown to the "
        "engineer and lowers the run's confidence. Never edit these tests.",
    ]
    for ce in failing:
        lines += [
            "",
            f"{ce.name}: `{ce.test_path}::{ce.test_name}` — claim: {ce.claim}",
            "```",
            ce.code[-3000:],
            "```",
            "Output with your fix:",
            "```",
            ce.failure_excerpt[-1500:],
            "```",
        ]
    return "\n".join(lines)


def counterexample_tools(
    deps: GraphDeps, failing: list[Counterexample], disputes: dict[str, str]
) -> list[StructuredTool]:
    by_name = {ce.name: ce for ce in failing}

    def run_counterexample(name: str) -> str:
        ce = by_name.get(name)
        if ce is None:
            return f"error: no failing counterexample {name!r} ({', '.join(by_name)})"
        if deps.runner is None:
            return "error: no sandbox available in this run"
        deps.ensure_sandbox()
        target = deps.app_root / ce.test_path
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text(ce.code, encoding="utf-8")
        try:
            result = deps.runner.run_tests(ce.test_path, ce.test_name)
        finally:
            target.unlink(missing_ok=True)
        text = result.summary()
        if result.excerpt and not result.passed:
            text += "\n" + result.excerpt[-2500:]
        return text

    def dispute_counterexample(name: str, reason: str) -> str:
        if name not in by_name:
            return f"error: no failing counterexample {name!r} ({', '.join(by_name)})"
        if name in disputes:
            return f"error: {name} is already disputed (one dispute per test)"
        if not reason.strip():
            return "error: give the reason, quoting the report or finding"
        disputes[name] = reason.strip()[:500]
        return f"{name} disputed; it will not send the fix back"

    return [
        StructuredTool.from_function(
            func=run_counterexample,
            name="run_counterexample",
            description="Run one failing reviewer counterexample against your change.",
            args_schema=RunCounterexampleArgs,
        ),
        StructuredTool.from_function(
            func=dispute_counterexample,
            name="dispute_counterexample",
            description=(
                "Dispute a reviewer counterexample that contradicts the report or the "
                "finding (wrong expected value, different behaviour than reported). "
                "Once per counterexample."
            ),
            args_schema=DisputeCounterexampleArgs,
        ),
    ]


def finish_tools() -> list[StructuredTool]:
    return [
        StructuredTool.from_function(
            func=_noop,
            name="submit_fix",
            description=SubmitFix.__doc__ or "",
            args_schema=SubmitFix,
        ),
        StructuredTool.from_function(
            func=_noop,
            name="give_up",
            description=GiveUp.__doc__ or "",
            args_schema=GiveUp,
        ),
    ]


def count_changed_lines(diff: str) -> int:
    return sum(
        1
        for line in diff.splitlines()
        if line[:1] in "+-" and not line.startswith(("+++", "---"))
    )


def forbidden_test_changes(diff: str) -> list[str]:
    hits = []
    for line in diff.splitlines():
        if _REMOVED_TEST.match(line):
            hits.append(f"removes a test: {line.strip()[:100]}")
        elif _ADDED_SKIP.match(line):
            hits.append(f"skips a test: {line.strip()[:100]}")
    return hits


def make_fix_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "fix")
    app_config = deps.config.app(deps.app)
    limits = deps.config.limits.run

    def fix(state: BugState, config=None) -> dict[str, Any]:
        shown: list[str] = []
        update = _fix(state, config, shown)
        if shown and isinstance(update, dict):
            update = {**update, "recalled": [*state.recalled, *shown]}
        return update

    def _fix(state: BugState, config, shown: list[str]) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        assert state.repro is not None and state.finding is not None
        repro = state.repro
        failing = [ce for ce in state.counterexamples if ce.status == "failed"]
        disputes: dict[str, str] = {}
        protected = (list(repro.file_hashes) or [repro.test_path]) + [
            ce.test_path for ce in state.counterexamples
        ]
        tools = [
            t
            for t in outline_first_read_tools(deps)
            if t.name in ("read_file", "grep", "glob", "list_dir")
        ] + [
            fix_edit_tool(deps, protected),
            repro_only_run_tests(deps, repro.test_path, repro.test_name),
            lint_tool(deps),
        ]
        if failing:
            tools += counterexample_tools(deps, failing, disputes)
        loop = ToolLoop(
            config=deps.config,
            node="fix",
            model=deps.model("fix"),
            spec=deps.config.model_for("fix"),
            tools=tools,
            finish_tools=finish_tools(),
            scratchpad=deps.scratchpad,
            counter=deps.counter,
            on_tool_call=lambda name, args, text: deps.tool_log.append(
                {
                    "node": "fix",
                    "tool": name,
                    "args": {
                        k: v for k, v in args.items() if k not in ("new_str", "old_str")
                    },
                    "chars": len(text),
                }
            ),
        )
        attempt = state.attempts + 1
        recall: list[str] = []
        if deps.memory is not None:
            from bug_hunter.memory.fingerprint import repo_path
            from bug_hunter.memory.recall import fix_recall

            recall = fix_recall(
                deps.memory,
                deps.app,
                f"{state.finding.title}: {state.finding.hypothesis}",
                [repo_path(f, deps.app_prefix) for f in state.finding.suspected_files],
            )
        if recall:
            from bug_hunter.memory.recall import ids_in

            shown.extend(ids_in(recall))
        ctx = node_context(deps, "fix", state, recall=recall)
        system = prompt.render(
            context=ctx.render(),
            app=deps.app,
            repro_test=f"{repro.test_path}::{repro.test_name}",
            max_lines=str(limits.max_fix_lines_changed),
        )
        user = (
            f"Attempt {attempt} of {limits.max_fix_attempts}. "
            "Make the reproduction test "
            "pass with the smallest source change, run it, then finish with submit_fix "
            "(or give_up)."
        )
        if (
            state.verification is not None
            and not state.verification.passed
            and attempt > 1
        ):
            ver = state.verification
            user += "\n\nThe previous attempt failed verification:\n" + ver.summary
            if ver.new_failures:
                user += "\nNew failures: " + "; ".join(ver.new_failures)
            if ver.repro_excerpt:
                user += "\n\nRepro test output:\n" + ver.repro_excerpt
            if ver.lint_excerpt:
                user += (
                    "\n\nLint output (the untouched code lints clean; fix the lines "
                    "you changed, never the lint configuration):\n" + ver.lint_excerpt
                )
            if ver.typecheck_excerpt:
                user += "\n\nTypecheck output:\n" + ver.typecheck_excerpt
        if (
            state.review is not None
            and state.review.verdict == "request_changes"
            and attempt > 1
        ):
            user += "\n\nThe reviewer asked for changes:\n- " + "\n- ".join(
                state.review.issues
            )
        if failing:
            user += "\n\n" + counterexample_feedback(failing)
        initial: LoopState = {
            "messages": initial_messages(system, user),
            "turns": 0,
            "result": None,
            "loop_stop": None,
            "budget_used": state.budget_used,
            "started_at": state.started_at,
            "app": state.app,
            "node": "fix",
        }
        out = run_loop(
            loop.build(), initial, config, deps.checkpointer, max_turns=loop.max_turns
        )
        budget = with_clock(out["budget_used"], state.started_at)
        result = out.get("result")
        base: dict[str, Any] = {"attempts": attempt, "budget_used": budget}
        if disputes:
            tests = []
            for ce in state.counterexamples:
                if ce.name in disputes:
                    ce = ce.model_copy(
                        update={
                            "status": "disputed",
                            "dispute_reason": disputes[ce.name],
                        }
                    )
                tests.append(ce)
            base["counterexamples"] = tests
            base["disputed"] = True
            if not state.disputed:  # confidence drops one level, once per run
                base["confidence"] = lower_confidence(state.confidence)
            deps.scratchpad.append_note(
                "fix: disputed "
                + "; ".join(f"{n}: {r[:120]}" for n, r in disputes.items())
            )
            gave_up = result is not None and result["tool"] == "give_up"
            if not gave_up and all(ce.name in disputes for ce in failing):
                # nothing left that sends the fix back: if the code is unchanged the
                # verified fix stands (no attempt spent) and goes on to the risk gate
                current = deps.git.diff(deps.worktree) if deps.git else ""
                previous = ""
                if state.patch is not None:
                    try:
                        previous = open(state.patch.diff_path, encoding="utf-8").read()
                    except OSError:
                        previous = ""
                if current.strip() == previous.strip():
                    return {
                        **base,
                        "attempts": state.attempts,
                        "status": "reviewed",
                    }
        if not result or result["tool"] != "submit_fix":
            reason = (
                result["args"]["reason"]
                if result
                else (out.get("loop_stop") or "fix ended without a change")
            )
            deps.scratchpad.append_note(f"fix attempt {attempt}: gave up: {reason}")
            return {
                **base,
                "status": "escalated",
                "stop_reason": f"fix: {reason}"[:400],
            }
        # the diff is measured, never trusted from the model
        diff = deps.git.diff(deps.worktree) if deps.git else ""
        files = [
            f
            for f in (
                deps.git.modified_tracked_files(deps.worktree) if deps.git else []
            )
            if f.startswith(app_config.path + "/") or deps.app_root == deps.worktree
        ]
        files = [f for f in files if not any(f.endswith(p) for p in protected)]
        lines = count_changed_lines(diff)
        diff_path = deps.write_artefact(f"fix-attempt-{attempt}.patch", diff)
        patch = Patch(
            branch=state.pr_branch or "",
            diff_path=str(diff_path),
            files_changed=files,
            lines_changed=lines,
            rationale=result["args"]["rationale"][:600],
        )
        forbidden = forbidden_test_changes(diff)
        if forbidden:
            deps.scratchpad.append_note(
                f"fix attempt {attempt}: forbidden: {forbidden[0]}"
            )
            return {
                **base,
                "patch": patch,
                "status": "escalated",
                "stop_reason": "fix changed tests: " + "; ".join(forbidden)[:350],
            }
        if lines > limits.max_fix_lines_changed:
            deps.scratchpad.append_note(
                f"fix attempt {attempt}: {lines} lines > {limits.max_fix_lines_changed}"
            )
            return {
                **base,
                "patch": patch,
                "status": "escalated",
                "stop_reason": (
                    f"fix too large: {lines} changed lines "
                    f"(limit {limits.max_fix_lines_changed})"
                ),
            }
        if not diff.strip():
            return {
                **base,
                "status": "escalated",
                "stop_reason": "fix: submit_fix without any change",
            }
        deps.scratchpad.append_note(
            f"fix attempt {attempt}: {lines} lines in {', '.join(files)}: "
            f"{patch.rationale}"
        )
        return {**base, "patch": patch, "status": "fixing"}

    return fix
