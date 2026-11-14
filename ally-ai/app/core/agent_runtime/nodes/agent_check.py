"""Check: citations resolved against every passage offered; a fact without
one is refused. See agent_runtime/check.py for the rules.

A refused draft goes back to the agent once, with the reason, so the person gets a
reply in the agent's own words (cited, or an honest "I don't have that") rather
than the bot's fixed decline wording. A second refusal is final.
"""

from __future__ import annotations

from typing import Any, Dict, Literal

from langgraph.graph import END

from app.core.agent_runtime.budget import (
    MAX_REVISIONS,
    SEARCH_AGAIN_RESERVE_SECONDS,
    can_send_back,
    recent,
    search_budget,
    searches,
    time_left,
)
from app.core.agent_runtime.check import (
    check_reply,
    organisation_of,
    rejection_feedback,
)
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools.lists import offers_create
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import is_general


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    result = update.get("result")
    if result is None:
        return f"sent back ({update['feedback']})"
    return (
        f"{result['intent']} ({result['turn_type']}), "
        f"{len(result['citations'])} citations"
    )


def make_agent_check_node(service: KnowledgeAgentService) -> Node:
    @traced("check", _summary, lambda _: "checking")
    async def agent_check(state: AgentState) -> Dict[str, Any]:
        retrieval = state.get("retrieval") or service.retrieval_meta(
            state["limits"],
            [],
            language=state["language"],
            translated=None,
            translation_degraded=False,
        )
        # Searches only: a gateway tool (chunk 3b) is not a search.
        searched = bool(searches(state))
        result, rejection = check_reply(
            state.get("agent_step") or {},
            state.get("agent_meta") or {},
            state.get("passages") or [],
            turn_type=state["turn_type"],
            language=state["language"],
            retrieval=retrieval,
            general=is_general(state["bot"].get("answer_mode")),
            search_gate=state.get("search_gate"),
            question=state["question"],
            searched=searched,
            organisation=organisation_of(state["bot"]),
            history=recent(state.get("history")) or (),
            safety_pack=(state["bot"].get("persona") or {}).get("safety_pack"),
            decline_text=state["bot"].get("decline_text"),
            avoid_topics=(state["bot"].get("persona") or {}).get("avoid_topics") or (),
            purpose=(state["bot"].get("persona") or {}).get("purpose"),
            can_book=offers_create(state["bot"].get("gateway_definitions")),
            can_search_again=len(searches(state)) == 1
            and search_budget(state) > 0
            and (state.get("revisions") or 0) < MAX_REVISIONS
            and time_left(state) >= SEARCH_AGAIN_RESERVE_SECONDS,
        )
        revisions = state.get("revisions") or 0
        # Without time for a rewrite the reply is final: a rewrite cut off by the
        # hard cap fails the run, and v1 would answer instead.
        if rejection and can_send_back(state, rejection):
            return {
                # What would go out if this draft were final (wording fixed, details
                # trimmed). Kept so a rewrite that is refused outright falls back to
                # it rather than to the bot's fixed decline wording.
                "fallback_result": json_safe(result) if result["answer"] else None,
                "feedback": rejection.value,
                "feedback_text": rejection_feedback(
                    rejection, state["agent_step"], searched=searched
                ),
                "revisions": revisions + 1,
            }
        fallback = state.get("fallback_result")
        if fallback and not result["answer"]:
            result = fallback
        return {"result": json_safe(result), "feedback": None, "feedback_text": None}

    return agent_check


def route_after_check(state: AgentState) -> Literal["agent", "__end__"]:
    return "agent" if state.get("feedback") else END
