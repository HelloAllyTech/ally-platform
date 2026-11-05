"""Check (agent): citations resolved against every passage offered; a fact without
one is declined. See agent_runtime/check.py for the rules."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.check import check_reply
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    result = update["result"]
    return (
        f"{result['intent']} ({result['turn_type']}), "
        f"{len(result['citations'])} citations"
    )


def make_agent_check_node(service: KnowledgeAgentService) -> Node:
    @traced("check", _summary)
    async def agent_check(state: AgentState) -> Dict[str, Any]:
        retrieval = state.get("retrieval") or service.retrieval_meta(
            state["limits"],
            [],
            language=state["language"],
            translated=state.get("translated_query"),
            translation_degraded=state.get("translation_degraded", False),
        )
        result = check_reply(
            state.get("agent_step") or {},
            state.get("agent_meta") or {},
            state.get("passages") or [],
            turn_type=state["turn_type"],
            language=state["language"],
            retrieval=dict(retrieval),
            general=state["bot"].get("answer_mode") == "documents_and_general",
            prefetch_gate=state.get("prefetch_gate"),
            tool_passages=state.get("tool_passages") or 0,
        )
        return {"result": json_safe(result)}

    return agent_check
