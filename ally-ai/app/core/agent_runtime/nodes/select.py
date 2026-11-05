"""Select: the passages within the similarity band, capped by count and tokens."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    return f"{len(update['passages'])} passages"


def make_select_node(service: KnowledgeAgentService) -> Node:
    @traced("select", _summary)
    async def select(state: AgentState) -> Dict[str, Any]:
        # A copy: `select` records passages_used on the block it is given, and a
        # node must not mutate state it did not return.
        retrieval = dict(state["retrieval"])
        passages = service.select(
            state["hits"],
            search_text=state["search_text"],
            limits=state["limits"],
            latency_ms=state["retrieval_latency_ms"],
            language=state["language"],
            retrieval=retrieval,
        )
        return {"passages": passages, "retrieval": retrieval}

    return select
