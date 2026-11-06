"""Check (agent): citations resolved against every passage offered; a fact without
one is refused. See agent_runtime/check.py for the rules.

A refused draft goes back to the agent once, with the reason, so the person gets a
reply in the agent's own words (cited, or an honest "I don't have that") rather
than the bot's fixed decline wording. A second refusal is final.
"""

from __future__ import annotations

from typing import Any, Dict, Literal

from app.core.agent_runtime.check import check_reply, rejection_feedback
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService

#: Rewrites allowed per message. One is enough to turn an uncited claim into an
#: honest reply; more would only add latency.
MAX_REVISIONS = 1


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    result = update.get("result")
    if result is None:
        return f"sent back ({update['feedback']})"
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
            translated=None,
            translation_degraded=False,
        )
        result, rejection = check_reply(
            state.get("agent_step") or {},
            state.get("agent_meta") or {},
            state.get("passages") or [],
            turn_type=state["turn_type"],
            language=state["language"],
            retrieval=dict(retrieval),
            general=state["bot"].get("answer_mode") == "documents_and_general",
            search_gate=state.get("search_gate"),
        )
        revisions = state.get("revisions") or 0
        if rejection and revisions < MAX_REVISIONS:
            return {
                "feedback": rejection,
                "feedback_text": rejection_feedback(
                    rejection,
                    state["agent_step"],
                    searched=bool(state.get("tool_calls")),
                ),
                "revisions": revisions + 1,
            }
        return {"result": json_safe(result), "feedback": None, "feedback_text": None}

    return agent_check


def route_after_check(state: AgentState) -> Literal["agent", "finalize"]:
    return "agent" if state.get("feedback") else "finalize"
