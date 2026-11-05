"""Check: map citation numbers to chunks; an empty answer becomes a decline."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import KnowledgeAnswer


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    result = update["result"]
    return f"{result['intent']}, {len(result['citations'])} citations"


def make_check_node(service: KnowledgeAgentService) -> Node:
    @traced("check", _summary)
    async def check(state: AgentState) -> Dict[str, Any]:
        result = service.check(
            KnowledgeAnswer(**state["answer_raw"]),
            state["answer_meta"],
            state["passages"],
            language=state["language"],
            retrieval=dict(state["retrieval"]),
        )
        return {"result": json_safe(result)}

    return check
