"""Gate: decline in code, with no model call, when nothing relevant was found."""

from __future__ import annotations

from typing import Any, Dict, Literal

from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    reason = update["gate_reason"]
    return f"decline ({reason})" if reason else "continue"


def make_gate_node(service: KnowledgeAgentService) -> Node:
    @traced("gate", _summary)
    async def gate(state: AgentState) -> Dict[str, Any]:
        reason = service.gate(
            state["hits"],
            decline_similarity=state["limits"]["decline_similarity"],
            general=state["bot"].get("answer_mode") == "documents_and_general",
            translation_degraded=state["translation_degraded"],
        )
        return {"gate_reason": reason.value if reason is not None else None}

    return gate


def route_after_gate(state: AgentState) -> Literal["select", "finalize"]:
    return "finalize" if state.get("gate_reason") else "select"
