"""Write: the answer call (persona block plus the answer template)."""

from __future__ import annotations

from typing import Any, Dict

from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.trace import Node, traced
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    meta = update["answer_meta"] or {}
    return f"{update['answer_raw']['intent']} via {meta.get('model') or 'model'}"


def make_write_node(service: KnowledgeAgentService) -> Node:
    @traced("write", _summary)
    async def write(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        parsed, meta = await service.write(
            state["question"],
            state["passages"],
            history=state.get("history") or None,
            prompts=bot.get("prompts"),
            persona=bot.get("persona"),
            general=bot.get("answer_mode") == "documents_and_general",
            max_answer_chars=bot["max_answer_chars"],
        )
        return {
            "answer_raw": parsed.model_dump(mode="json"),
            "answer_meta": json_safe(dict(meta or {})),
        }

    return write
