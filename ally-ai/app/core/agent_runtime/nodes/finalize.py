"""Finalize: the response for this run, including declines that came from the gate."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import DeclineReason


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    return update["result"]["intent"]


def make_finalize_node(service: KnowledgeAgentService) -> Node:
    @traced("finalize", _summary)
    async def finalize(state: AgentState) -> Dict[str, Any]:
        reason = state.get("gate_reason")
        if not reason:
            return {"result": state["result"]}
        # Built (and reported to the retrieval log) here rather than in `gate`, so
        # the gate stays a pure decision and the log fires once, as in the old path.
        result = service.decline(
            DeclineReason(reason),
            search_text=state["search_text"],
            hits=state["hits"],
            limits=state["limits"],
            latency_ms=state["retrieval_latency_ms"],
            language=state["language"],
            retrieval=dict(state["retrieval"]),
            log_retrieval=state["bot"].get("log_retrieval", True),
        )
        return {"result": json_safe(result)}

    return finalize
