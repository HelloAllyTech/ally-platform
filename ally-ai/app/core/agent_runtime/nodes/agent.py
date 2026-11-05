"""Agent: one model call that either asks for a tool or replies."""

from __future__ import annotations

from typing import Any, Dict, Literal

from app.core.agent_runtime import conversation
from app.core.agent_runtime.schemas import REPLY_ACTION
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import allowed_tools
from app.core.agent_runtime.trace import Node, traced
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    step = update["agent_step"]
    model = (update["agent_meta"] or {}).get("model") or "model"
    if step.get("action", REPLY_ACTION) != REPLY_ACTION:
        return f"calls {step['action']} via {model}"
    return f"{step.get('intent')} via {model}"


def tool_budget(state: AgentState) -> int:
    return max(
        0, settings.AGENT_RUNTIME.MAX_TOOL_CALLS - len(state.get("tool_calls") or [])
    )


def make_agent_node(service: KnowledgeAgentService) -> Node:
    @traced("agent", _summary)
    async def agent(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        budget = tool_budget(state)
        # Past the cap the schema itself offers only `reply`.
        tools = allowed_tools(bot) if budget > 0 else []
        step, meta = await conversation.agent_step(
            state["question"],
            passages=state.get("passages") or [],
            tools=tools,
            tool_budget=budget,
            bot=bot,
            history=state.get("history") or None,
            turn_type=state.get("turn_type"),
            standalone_query=state.get("standalone_query"),
            searches=state.get("tool_calls") or [],
        )
        return {
            "agent_step": json_safe(step),
            "agent_meta": json_safe(meta),
            "agent_calls": (state.get("agent_calls") or 0) + 1,
        }

    return agent


def route_after_agent(state: AgentState) -> Literal["tools", "agent_check"]:
    action = (state.get("agent_step") or {}).get("action", REPLY_ACTION)
    if action != REPLY_ACTION and tool_budget(state) > 0:
        return "tools"
    return "agent_check"
