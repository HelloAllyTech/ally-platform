"""Agent: one model call that reads the conversation and either asks for a tool or
replies. It is the first step of the agent path: there is no classifier or
up-front search before it, so whether to search, and for what, is its decision."""

from __future__ import annotations

import time
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
        return f"{step.get('turn_type')}, calls {step['action']} via {model}"
    return f"{step.get('turn_type')}, {step.get('intent')} via {model}"


#: Refusals after which, if nothing has been searched, the next step must search.
MUST_SEARCH_AFTER = ("uncited", "search_first")


def recent(history: Any) -> Any:
    """The last MAX_HISTORY_MESSAGES of the conversation; None when empty."""
    keep = settings.AGENT_RUNTIME.MAX_HISTORY_MESSAGES
    return list(history or [])[-keep:] if history and keep else None


def over_time(state: AgentState) -> bool:
    """Whether the run has used its time budget (RUN_BUDGET_SECONDS)."""
    started = state.get("started_at")
    return bool(
        started and time.time() - started > settings.AGENT_RUNTIME.RUN_BUDGET_SECONDS
    )


def tool_budget(state: AgentState) -> int:
    """Searches left: none past the cap, past the time budget, or once a search
    added nothing new (another phrasing of the same miss only costs time)."""
    calls = state.get("tool_calls") or []
    if calls and not calls[-1].get("added") and not calls[-1].get("refused"):
        return 0
    if over_time(state):
        return 0
    return max(0, settings.AGENT_RUNTIME.MAX_TOOL_CALLS - len(calls))


def make_agent_node(service: KnowledgeAgentService) -> Node:
    @traced("agent", _summary)
    async def agent(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        start: Dict[str, Any] = {}
        if not state.get("agent_calls"):
            # First step of the run: the working keys the rest of the path reads.
            start = {
                "limits": service.resolve_limits(**bot.get("limits", {})),
                "passages": [],
                "tool_calls": [],
                "tool_passages": 0,
                "revisions": 0,
                "translation_degraded": False,
                "started_at": time.time(),
            }
        budget = tool_budget(state)
        # Past the cap the schema itself offers only `reply`.
        tools = allowed_tools(bot) if budget > 0 else []
        # Sent back for not searching, and still nothing searched: this step can
        # only search. Asking alone was not enough in the eval.
        must_search = bool(
            tools
            and state.get("feedback") in MUST_SEARCH_AFTER
            and not state.get("tool_calls")
        )
        step, meta = await conversation.agent_step(
            state["question"],
            passages=state.get("passages") or [],
            tools=tools,
            tool_budget=budget,
            bot=bot,
            history=recent(state.get("history")),
            searches=state.get("tool_calls") or [],
            feedback=state.get("feedback_text"),
            must_search=must_search,
        )
        return {
            **start,
            "agent_step": json_safe(step),
            "agent_meta": json_safe(meta),
            "agent_calls": (state.get("agent_calls") or 0) + 1,
            "turn_type": step.get("turn_type") or "question",
            "language": (step.get("language") or "en").strip() or "en",
            "feedback": None,
            "feedback_text": None,
        }

    return agent


def route_after_agent(state: AgentState) -> Literal["tools", "agent_check"]:
    # Only the cap here: a step that was offered a search runs it, even if the time
    # budget ran out while the model was deciding.
    action = (state.get("agent_step") or {}).get("action", REPLY_ACTION)
    calls = len(state.get("tool_calls") or [])
    if action != REPLY_ACTION and calls < settings.AGENT_RUNTIME.MAX_TOOL_CALLS:
        return "tools"
    return "agent_check"
