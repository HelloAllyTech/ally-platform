"""Contextualise: what the latest message is, using the conversation, and what to
search for. Replaces translate when `features.agent` is on."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime import conversation
from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    if update["translation_degraded"]:
        return "failed, searching the original text"
    rewritten = ", rewritten" if update["translated_query"] else ""
    return f"{update['turn_type']}, {update['language']}{rewritten}"


def make_contextualize_node(service: KnowledgeAgentService) -> Node:
    @traced("contextualize", _summary)
    async def contextualize(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        question = state["question"]
        understood, degraded = await conversation.contextualize(
            question,
            history=state.get("history") or None,
            prompts=bot.get("prompts"),
        )
        standalone = (understood.standalone_query or "").strip()
        search_text = standalone if understood.turn_type == "question" else ""
        search_text = search_text or question
        return {
            "limits": service.resolve_limits(**bot.get("limits", {})),
            "turn_type": understood.turn_type,
            "standalone_query": standalone or None,
            "search_text": search_text,
            "language": (understood.language or "en").strip() or "en",
            "translated_query": search_text if search_text != question else None,
            "translation_degraded": degraded,
            "passages": [],
            "tool_calls": [],
            "tool_passages": 0,
            "agent_calls": 0,
        }

    return contextualize


def route_after_contextualize(state: AgentState) -> str:
    """Only a question is searched up front; everything else goes straight to the
    agent with no passages."""
    return "prefetch" if state.get("turn_type") == "question" else "agent"
