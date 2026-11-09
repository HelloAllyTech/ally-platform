"""Trace the data flow and form a hypothesis with evidence, or say there is no bug.
A tool loop over read-only tools; the finish tools carry the structured result."""

from __future__ import annotations

from typing import Any

from langchain_core.tools import StructuredTool
from pydantic import BaseModel, ConfigDict, Field

from bug_hunter.graph.budget import with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.loop import LoopState, ToolLoop, initial_messages, run_loop
from bug_hunter.graph.nodes.common import node_context, over_budget
from bug_hunter.graph.prompts import load_prompt
from bug_hunter.graph.state import CATEGORIES, BugState, Confidence, Finding, Severity
from bug_hunter.tools.lc import map_tools, read_tools


class SubmitFinding(BaseModel):
    """Finish: a concrete bug with evidence. Use only when the data flow is traced."""

    model_config = ConfigDict(extra="forbid")

    title: str = Field(description="One line, the symptom and where")
    category: str = Field(
        description="logic | crash | error_handling | null | contract | race | "
        "security | other"
    )
    severity: Severity
    suspected_files: list[str] = Field(description="App-relative paths")
    evidence: list[str] = Field(
        description="Concrete observations with file:line, each one checkable"
    )
    hypothesis: str = Field(description="What goes wrong and why, 2-4 sentences")
    root_cause: str = Field(description="The defect, with file:line")
    confidence: Confidence = Field(
        description="high only with a failing test; medium when the flow is traced"
    )


class ReportNoBug(BaseModel):
    """Finish: nothing wrong found, or the report is not a bug. A valued answer."""

    model_config = ConfigDict(extra="forbid")

    reason: str = Field(description="What you checked and why it is fine")
    confidence: Confidence


def _noop(**_: Any) -> str:  # finish tools are never executed, only parsed
    return "ok"


def finish_tools() -> list[StructuredTool]:
    return [
        StructuredTool.from_function(
            func=_noop,
            name="submit_finding",
            description=SubmitFinding.__doc__ or "",
            args_schema=SubmitFinding,
        ),
        StructuredTool.from_function(
            func=_noop,
            name="report_no_bug",
            description=ReportNoBug.__doc__ or "",
            args_schema=ReportNoBug,
        ),
    ]


def make_investigate_node(deps: GraphDeps):
    prompt = load_prompt(deps.config, "investigate")
    tools = read_tools(deps.workspace, deps.git)
    if deps.repo_map is not None:
        tools += map_tools(deps.repo_map)
    loop = ToolLoop(
        config=deps.config,
        node="investigate",
        model=deps.model("investigate"),
        spec=deps.config.model_for("investigate"),
        tools=tools,
        finish_tools=finish_tools(),
        scratchpad=deps.scratchpad,
        counter=deps.counter,
        on_tool_call=lambda name, args, text: deps.tool_log.append(
            {"node": "investigate", "tool": name, "args": args, "chars": len(text)}
        ),
    )
    compiled = loop.build()

    def investigate(state: BugState, config=None) -> dict[str, Any]:
        stop = over_budget(deps, state)
        if stop:
            return stop
        neighbourhood = ""
        if deps.mode == "sweep" and deps.diff and deps.repo_map is not None:
            try:
                neighbourhood = deps.repo_map.neighbourhood(deps.diff).render()
            except Exception:  # noqa: BLE001 - help, not a requirement
                neighbourhood = ""
        ctx = node_context(deps, "investigate", state)
        system = prompt.render(
            context=ctx.render(),
            app=state.app or deps.app,
            mode=state.mode,
            neighbourhood=neighbourhood or "(no call-graph neighbourhood available)",
            tools=", ".join(t.name for t in tools),
        )
        user = (
            "Investigate the report above. Read the code before you decide. Finish "
            "with submit_finding or report_no_bug."
            if state.mode == "issue"
            else "Review the diff above (signal-diff.patch is in the artefacts; the "
            "summary is in the context). Read the surrounding code before you decide. "
            "Finish with submit_finding or report_no_bug."
        )
        initial: LoopState = {
            "messages": initial_messages(system, user),
            "turns": 0,
            "result": None,
            "loop_stop": None,
            "budget_used": state.budget_used,
            "started_at": state.started_at,
            "node": "investigate",
        }
        out = run_loop(
            compiled, initial, config, deps.checkpointer, max_turns=loop.max_turns
        )
        budget = with_clock(out["budget_used"], state.started_at)
        result = out.get("result")
        if result and result["tool"] == "submit_finding":
            args = result["args"]
            finding = Finding(
                app=state.app or deps.app,  # type: ignore[arg-type]
                title=args["title"],
                category=(
                    args["category"] if args["category"] in CATEGORIES else "other"
                ),
                severity=args["severity"],
                suspected_files=args["suspected_files"],
                evidence=args["evidence"],
                hypothesis=args["hypothesis"],
            )
            deps.scratchpad.append_note(
                f"investigate: finding '{finding.title}' ({args['confidence']}): "
                f"{args['root_cause']}"
            )
            return {
                "finding": finding,
                "root_cause": args["root_cause"],
                "confidence": args["confidence"],
                "status": "investigating",
                "budget_used": budget,
            }
        if result and result["tool"] == "report_no_bug":
            deps.scratchpad.append_note(
                f"investigate: no bug: {result['args']['reason']}"
            )
            return {
                "status": "closed_not_bug",
                "no_bug_reason": result["args"]["reason"],
                "confidence": result["args"]["confidence"],
                "budget_used": budget,
            }
        reason = out.get("loop_stop") or "investigation ended without a conclusion"
        deps.scratchpad.append_note(f"investigate: stopped: {reason}")
        if "budget exceeded" in reason:
            return {"status": "escalated", "stop_reason": reason, "budget_used": budget}
        # out of turns with no conclusion: nothing proven, nothing to escalate
        return {
            "status": "closed_not_bug",
            "no_bug_reason": f"inconclusive: {reason}",
            "stop_reason": reason,
            "budget_used": budget,
        }

    return investigate
