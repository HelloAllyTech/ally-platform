from __future__ import annotations

from typing import Any

from langchain_core.messages import AIMessage

from bug_hunter.context.builder import NodeContext, build_context
from bug_hunter.graph.budget import charge, exceeded, with_clock
from bug_hunter.graph.deps import GraphDeps
from bug_hunter.graph.state import Budget, BugState


def state_dict(state: BugState) -> dict[str, Any]:
    return state.model_dump()


def node_context(
    deps: GraphDeps, node: str, state: BugState, **extra: str
) -> NodeContext:
    return build_context(
        deps.config,
        node,
        state_dict(state),
        app_context=deps.app_context,
        scratchpad=deps.scratchpad,
        memory_recall=[],  # long-term memory arrives in chunk 07
        extra=extra or None,
        counter=deps.counter,
    )


def over_budget(deps: GraphDeps, state: BugState) -> dict[str, Any] | None:
    """The partial update that stops the run when a cap is hit, else None."""
    reason = exceeded(deps.config, state.budget_used, state.started_at, state.app)
    if reason is None:
        return None
    deps.scratchpad.append_note(f"stopped: {reason}")
    return {
        "stop_reason": reason,
        "status": "escalated",
        "budget_used": with_clock(state.budget_used, state.started_at),
    }


def charge_all(
    deps: GraphDeps,
    budget: Budget,
    node: str,
    role: str,
    raws: list[AIMessage],
    secs: float,
) -> Budget:
    spec = deps.config.model_for(role)
    for raw in raws:
        budget = charge(deps.config, budget, node, spec, raw, secs / max(1, len(raws)))
    return budget
