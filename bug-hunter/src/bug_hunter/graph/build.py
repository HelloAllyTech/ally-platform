"""Build and compile graph v1, and run it for one signal."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.nodes.approve import make_human_approval_node, make_open_pr_node
from bug_hunter.graph.nodes.challenge import make_challenge_node
from bug_hunter.graph.nodes.escalate import make_escalate_node
from bug_hunter.graph.nodes.fix import make_fix_node
from bug_hunter.graph.nodes.intake import make_intake_node
from bug_hunter.graph.nodes.investigate import make_investigate_node
from bug_hunter.graph.nodes.report import make_report_node
from bug_hunter.graph.nodes.reproduce import make_reproduce_node
from bug_hunter.graph.nodes.review import make_review_node
from bug_hunter.graph.nodes.risk import make_risk_gate_node, make_risk_precheck_node
from bug_hunter.graph.nodes.suggest import make_suggest_fix_node
from bug_hunter.graph.nodes.triage import make_triage_node
from bug_hunter.graph.nodes.verify import make_verify_node
from bug_hunter.graph.routing import (
    after_challenge,
    after_fix,
    after_investigate,
    after_open_pr,
    after_reproduce,
    after_review,
    after_risk_gate,
    after_risk_precheck,
    after_triage,
    after_verify,
)
from bug_hunter.graph.state import BugState, Signal


def build_graph(deps: GraphDeps, checkpointer: BaseCheckpointSaver | None = None):
    graph = StateGraph(BugState)
    graph.add_node("intake", make_intake_node(deps))
    graph.add_node("triage", make_triage_node(deps))
    graph.add_node("investigate", make_investigate_node(deps))
    graph.add_node("reproduce", make_reproduce_node(deps))
    graph.add_node("escalate", make_escalate_node(deps))
    graph.add_node("report", make_report_node(deps))

    graph.add_edge(START, "intake")
    graph.add_edge("intake", "triage")
    graph.add_conditional_edges(
        "triage", after_triage, ["investigate", "report", "escalate"]
    )
    graph.add_conditional_edges(
        "investigate", after_investigate, ["reproduce", "report", "escalate"]
    )
    graph.add_conditional_edges(
        "reproduce", after_reproduce, ["risk_precheck", "escalate"]
    )
    graph.add_node("risk_precheck", make_risk_precheck_node(deps))
    graph.add_node("fix", make_fix_node(deps))
    graph.add_node("verify", make_verify_node(deps))
    graph.add_node("review", make_review_node(deps))
    graph.add_node("risk_gate", make_risk_gate_node(deps))
    graph.add_node("open_pr", make_open_pr_node(deps))
    graph.add_node("human_approval", make_human_approval_node(deps))
    graph.add_node("suggest_fix", make_suggest_fix_node(deps))
    graph.add_node("challenge", make_challenge_node(deps))
    output_mode = deps.config.limits.pr.output_mode
    max_attempts = deps.config.limits.run.max_fix_attempts
    graph.add_conditional_edges(
        "risk_precheck", after_risk_precheck, ["fix", "escalate"]
    )
    graph.add_conditional_edges("fix", after_fix, ["verify", "risk_gate", "escalate"])
    graph.add_conditional_edges(
        "verify", lambda s: after_verify(s, max_attempts), ["review", "fix", "escalate"]
    )
    graph.add_conditional_edges(
        "review",
        lambda s: after_review(s, max_attempts),
        ["risk_gate", "fix", "challenge", "escalate"],
    )
    graph.add_conditional_edges(
        "challenge", after_challenge, ["fix", "risk_gate", "escalate"]
    )
    graph.add_conditional_edges(
        "risk_gate",
        lambda s: after_risk_gate(s, output_mode),
        ["open_pr", "suggest_fix", "escalate"],
    )
    graph.add_conditional_edges(
        "open_pr", after_open_pr, ["human_approval", "escalate"]
    )
    graph.add_edge("human_approval", "report")
    graph.add_edge("suggest_fix", "report")
    graph.add_edge("escalate", "report")
    graph.add_edge("report", END)
    deps.checkpointer = checkpointer
    return graph.compile(checkpointer=checkpointer)


def initial_state(deps: GraphDeps, signal: Signal) -> BugState:
    return BugState(
        run_id=deps.run_id,
        signal=signal,
        mode=deps.mode,  # type: ignore[arg-type]
        app=deps.app,  # type: ignore[arg-type]
        ref=deps.ref,
        started_at=datetime.now(timezone.utc).isoformat(timespec="seconds"),
        scratchpad_path=str(deps.scratchpad.path),
    )


def run_config(deps: GraphDeps, tags: list[str] | None = None) -> RunnableConfig:
    return {
        "configurable": {"thread_id": deps.run_id},
        "tags": [deps.run_id, deps.app, deps.mode, *(tags or [])],
        "metadata": {"run_id": deps.run_id, "app": deps.app, "mode": deps.mode},
        "recursion_limit": 50,
    }


def run_graph(
    compiled,
    deps: GraphDeps,
    signal: Signal | None,
    resume: bool = False,
    resume_with: dict[str, Any] | None = None,
) -> BugState:
    """Run, ``resume`` from the checkpoint, or answer a pending human_approval
    interrupt with ``resume_with`` (``{"decision": ..., "by": ..., "reason": ...}``).
    Returns the final ``BugState``; while paused at human_approval the returned state
    has ``status == "awaiting_human"``."""
    from langgraph.types import Command

    config = run_config(deps)
    if resume_with is not None:
        payload: Any = Command(resume=resume_with)
    elif resume:
        payload = None
    else:
        payload = initial_state(deps, signal)  # type: ignore[arg-type]
    final = compiled.invoke(payload, config)
    if "__interrupt__" in final:
        snapshot = compiled.get_state(config)
        values = snapshot.values
        state = (
            values if isinstance(values, BugState) else BugState.model_validate(values)
        )
        return state.model_copy(update={"status": "awaiting_human"})
    return final if isinstance(final, BugState) else BugState.model_validate(final)
