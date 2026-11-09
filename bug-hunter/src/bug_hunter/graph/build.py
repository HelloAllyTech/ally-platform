"""Build and compile graph v1, and run it for one signal."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from langchain_core.runnables import RunnableConfig
from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph

from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.nodes.escalate import make_escalate_node
from bug_hunter.graph.nodes.intake import make_intake_node
from bug_hunter.graph.nodes.investigate import make_investigate_node
from bug_hunter.graph.nodes.report import make_report_node
from bug_hunter.graph.nodes.reproduce import make_reproduce_node
from bug_hunter.graph.nodes.triage import make_triage_node
from bug_hunter.graph.routing import after_investigate, after_reproduce, after_triage
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
    graph.add_conditional_edges("reproduce", after_reproduce, ["report", "escalate"])
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
    compiled, deps: GraphDeps, signal: Signal | None, resume: bool = False
) -> BugState:
    """Run (or ``resume`` from the checkpoint) and return the final ``BugState``."""
    config = run_config(deps)
    payload: Any = None if resume else initial_state(deps, signal)  # type: ignore
    final = compiled.invoke(payload, config)
    return final if isinstance(final, BugState) else BugState.model_validate(final)
