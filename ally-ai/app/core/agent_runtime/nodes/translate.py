"""Translate: detect the language and restate the question in English for search."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    if update["translation_degraded"]:
        return "failed, searching the original text"
    if update["translated_query"] is None:
        return f"{update['language']}, searched as written"
    return f"{update['language']} → en"


def make_translate_node(service: KnowledgeAgentService) -> Node:
    @traced("translate", _summary)
    async def translate(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        search_text, language, translated, degraded = await service.translate(
            state["question"],
            prompts=bot.get("prompts"),
            enabled=bot.get("translate_query", True),
        )
        return {
            "limits": service.resolve_limits(**bot.get("limits", {})),
            "search_text": search_text,
            "language": language,
            "translated_query": translated,
            "translation_degraded": degraded,
        }

    return translate
