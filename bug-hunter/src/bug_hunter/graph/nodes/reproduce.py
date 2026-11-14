"""Write a minimal failing test, run it, and confirm it fails *for the hypothesised
reason*. Code decides first (setup failures, passes and empty runs are never a
reproduction); only a genuine failure is put to the model for the right-reason check.
"""

from __future__ import annotations

from typing import Any

from langchain_core.messages import HumanMessage, SystemMessage
from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.failure import classify_failure, describe
from bug_hunter.graph.llm import StructuredOutputError, call_structured
from bug_hunter.graph.loop import LoopState, ToolLoop, initial_messages, run_loop
from bug_hunter.graph.nodes.common import charge_all, node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import BugState, Repro
from bug_hunter.graph.tools import neighbour_test_setup, outline_first_read_tools
from bug_hunter.graph.verify import hashes_for
from bug_hunter.safety.phi import scrub_code
from bug_hunter.tools.lc import RunTestsArgs, WriteTestFileArgs
from bug_hunter.tools.runner import RunResult, single_test_command

EXCERPT_MAX = 2500


class SubmitRepro(BaseModel):
    """Finish: the test you wrote fails on the current code because of the bug."""

    model_config = ConfigDict(extra="forbid")

    test_path: str = Field(description="App-relative path of the test file you wrote")
    test_name: str = Field(description="The failing test's name, exactly as declared")
    expected_failure: str = Field(
        description="Which assertion fails and why that demonstrates the hypothesis"
    )


class CannotReproduce(BaseModel):
    """Finish: you could not make a test fail for the hypothesised reason."""

    model_config = ConfigDict(extra="forbid")

    reason: str
    tried: list[str] = Field(default_factory=list, description="What you attempted")


class RightReasonJudgement(BaseModel):
    model_config = ConfigDict(extra="forbid")

    related: bool = Field(
        description="True only if the failure is the hypothesised defect showing, "
        "not a setup problem, a wrong expectation or an unrelated bug"
    )
    why: str


def _noop(**_: Any) -> str:
    return "ok"


def finish_tools() -> list[StructuredTool]:
    return [
        StructuredTool.from_function(
            func=_noop,
            name="submit_repro",
            description=SubmitRepro.__doc__ or "",
            args_schema=SubmitRepro,
        ),
        StructuredTool.from_function(
            func=_noop,
            name="cannot_reproduce",
            description=CannotReproduce.__doc__ or "",
            args_schema=CannotReproduce,
        ),
    ]


def _run_result_text(result: RunResult) -> str:
    text = result.summary()
    if result.excerpt:
        text += "\n" + result.excerpt
    return text


def make_reproduce_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "reproduce")
    app_config = deps.config.app(deps.app)

    def write_test_file(path: str, content: str) -> str:
        return deps.workspace.write_test_file(path, content)

    def run_tests(target: str | None = None, name: str | None = None) -> str:
        if not target:
            return "error: run one test file (target), never the whole suite here"
        if deps.runner is None:
            return "error: no sandbox available in this run"
        deps.ensure_sandbox()
        return _run_result_text(deps.runner.run_tests(target, name))

    tools = [
        t
        for t in outline_first_read_tools(deps)
        if t.name in ("read_file", "grep", "glob", "list_dir")
    ] + [
        StructuredTool.from_function(
            func=write_test_file,
            name="write_test_file",
            description=(
                "Create a new test file in the app's test location. Never overwrites."
            ),
            args_schema=WriteTestFileArgs,
        ),
        StructuredTool.from_function(
            func=run_tests,
            name="run_tests",
            description="Run one test file (optionally one test) in the sandbox.",
            args_schema=RunTestsArgs,
        ),
    ]
    loop = ToolLoop(
        config=deps.config,
        node="reproduce",
        model=deps.model("fix"),
        spec=deps.config.model_for("fix"),
        tools=tools,
        finish_tools=finish_tools(),
        scratchpad=deps.scratchpad,
        counter=deps.counter,
        on_tool_call=lambda name, args, text: deps.tool_log.append(
            {
                "node": "reproduce",
                "tool": name,
                "args": {k: v for k, v in args.items() if k != "content"},
                "chars": len(text),
            }
        ),
    )
    compiled = loop.build()

    def reproduce(state: BugState, config=None) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        assert state.finding is not None
        ctx = node_context(deps, "reproduce", state)
        values = dict(
            context=ctx.render(),
            app=state.app or deps.app,
            test_dirs=", ".join(app_config.test_dirs) or "(see app context)",
            test_command=app_config.test_one or app_config.test,
        )
        if "neighbour_setup" in prompt.inputs:  # reproduce.v5+
            values["neighbour_setup"] = scrub_code(
                neighbour_test_setup(deps, state.finding.suspected_files)
            )
        system = prompt.render(**values)
        user = (
            "Write one minimal test that fails because of the finding above, run it "
            "with run_tests, then finish with submit_repro (or cannot_reproduce)."
        )
        initial: LoopState = {
            "messages": initial_messages(system, user),
            "turns": 0,
            "result": None,
            "loop_stop": None,
            "budget_used": state.budget_used,
            "started_at": state.started_at,
            "app": state.app,
            "node": "reproduce",
        }
        max_attempts = deps.config.limits.run.max_repro_attempts
        attempts = 0
        run_result = None
        kind = "genuine"
        current: LoopState = initial
        while True:
            out = run_loop(
                compiled, current, config, deps.checkpointer, max_turns=loop.max_turns
            )
            result = out.get("result")
            if not result or result["tool"] != "submit_repro":
                break
            claim = result["args"]
            if deps.runner is None:
                break
            deps.ensure_sandbox()
            run_result = deps.runner.run_tests(claim["test_path"], claim["test_name"])
            kind = classify_failure(app_config, run_result)
            if kind not in ("passed", "no_tests", "setup") or attempts >= max_attempts:
                break
            # the claim did not hold: the test passed on the buggy code, or no test
            # ran. Send the agent back with the output; this is an attempt, not a
            # reproduction (prose alone did not stop agents submitting passing tests)
            attempts += 1
            deps.scratchpad.append_note(
                f"reproduce: attempt {attempts}/{max_attempts}: "
                f"{claim['test_path']}::{claim['test_name']} -> {kind}; bounced back"
            )
            bounce = (
                f"Your submitted test `{claim['test_path']}::{claim['test_name']}` "
                + (
                    "PASSED on the current (buggy) code. A passing test is not a "
                    "reproduction: either the assertion states behaviour that already "
                    "holds, or the input never reaches the defective line. Rewrite it "
                    "so it fails because of the hypothesised defect, run it, and "
                    "submit again; or finish with cannot_reproduce."
                    if kind == "passed"
                    else (
                        "FAILED BEFORE REACHING THE BEHAVIOUR: a setup problem "
                        "(missing "
                        "provider, context, mock or import). Compare with the existing "
                        "tests' setup, fix the test, run it, and submit again."
                        if kind == "setup"
                        else "ran NO TEST (wrong path or name filter). Check the file "
                        "path and the exact test name, run it again, and submit again."
                    )
                )
                + f" (attempt {attempts} of {max_attempts})\n\nOutput:\n"
                + (run_result.excerpt or "")[-EXCERPT_MAX:]
            )
            current = {
                **out,
                "messages": [*out["messages"], HumanMessage(content=bounce)],
                "result": None,
                "loop_stop": None,
            }
        budget = with_clock(out["budget_used"], state.started_at)
        if not result or result["tool"] != "submit_repro":
            reason = (
                result["args"]["reason"]
                if result
                else (out.get("loop_stop") or "reproduce ended without a test")
            )
            stop = (
                reason  # a budget stop is reported as such, not as a repro failure
                if "budget exceeded" in reason
                else f"could not reproduce: {reason}"
            )
            deps.scratchpad.append_note(f"reproduce: {stop}")
            return {
                "status": "escalated",
                "stop_reason": stop[:400],
                "budget_used": budget,
                "repro_attempts": attempts,
            }
        args = result["args"]
        # the agent's claim was verified in code above: exactly that test was run
        if deps.runner is None or run_result is None:
            return {
                "status": "escalated",
                "stop_reason": "could not reproduce: no sandbox to run the test",
                "budget_used": budget,
                "repro_attempts": attempts,
            }
        excerpt = (run_result.excerpt or "")[-EXCERPT_MAX:]
        command = single_test_command(app_config, args["test_path"], args["test_name"])
        related, judgement = False, describe(kind)
        if kind == "genuine":
            system_j = (
                "You judge whether a failing test demonstrates a specific hypothesised "
                "bug. Say related=true when the failing assertion is about the "
                "observable symptom the hypothesis predicts (a wrong value, a missing "
                "call, a rejected input, a thrown error) and the failure would go away "
                "if the hypothesised defect were fixed. The test does not have to "
                "assert internal call arguments or the mechanism; the symptom is "
                "enough. Say related=false only for setup failures (import, module, "
                "fixture, compile, timeout), flaky timing, assertions on unrelated "
                "code, or a failure that the hypothesised fix would not change."
            )
            user_j = (
                f"Hypothesis:\n{state.finding.hypothesis}\n\nRoot cause claimed:\n"
                f"{state.root_cause}\n\nThe agent expected:\n{args['expected_failure']}"
                f"\n\nTest output (scrubbed, tail):\n{excerpt}"
            )
            try:
                verdict, raws, secs = call_structured(
                    deps.model("fix"),
                    RightReasonJudgement,
                    [SystemMessage(content=system_j), HumanMessage(content=user_j)],
                )
                budget = charge_all(deps, budget, "reproduce", "fix", raws, secs)
                related, judgement = verdict.related, verdict.why
            except StructuredOutputError as exc:
                related, judgement = False, f"judgement failed: {exc}"[:300]
        repro = Repro(
            test_path=args["test_path"],
            test_name=args["test_name"],
            command=command,
            failing_output_excerpt=excerpt,
            fails_for_the_right_reason=related,
            failure_kind=kind,
            judgement=judgement,
            file_hashes=hashes_for(deps.app_root, [args["test_path"]]),
        )
        deps.scratchpad.append_note(
            f"reproduce: {args['test_path']}::{args['test_name']} -> {kind}; "
            f"right reason={related}: {judgement}"
        )
        if related:
            return {
                "repro": repro,
                "status": "reproduced",
                "budget_used": budget,
                "repro_attempts": attempts,
            }
        exhausted = (
            f" after {attempts} bounced attempts"
            if kind in ("passed", "no_tests") and attempts
            else ""
        )
        return {
            "repro": repro,
            "status": "escalated",
            "stop_reason": (
                f"could not reproduce: {describe(kind)}{exhausted}; {judgement}"[:400]
            ),
            "budget_used": budget,
            "repro_attempts": attempts,
        }

    return reproduce
