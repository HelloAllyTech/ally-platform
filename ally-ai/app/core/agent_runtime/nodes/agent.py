"""Agent: one model call that reads the conversation and either asks for a tool or
replies. It is the run's first step: there is no classifier or up-front search
before it, so whether to search, and for what, is its decision."""

from __future__ import annotations

import time
from typing import Any, Dict, Literal, Tuple, Union

from app.core.agent_runtime import conversation
from app.core.agent_runtime.budget import (
    MAX_TOOL_STEPS,
    MUST_SEARCH_AFTER,
    REWRITE_RESERVE_SECONDS,
    is_search,
    recent,
    search_budget,
    searches,
    steps_left,
)
from app.core.agent_runtime.schemas import REPLY_ACTION
from app.core.agent_runtime.state import AgentState, json_safe
from app.core.agent_runtime.tools import gateway_tools, search_tools
from app.core.agent_runtime.trace import Node, StatusCode, trace_step, traced
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.exceptions.custom_exceptions import LLMInvocationFailedException


def _summary(_: AgentState, update: Dict[str, Any]) -> str:
    step = update["agent_step"]
    model = (update["agent_meta"] or {}).get("model") or "model"
    if step.get("action", REPLY_ACTION) != REPLY_ACTION:
        return f"{step.get('turn_type')}, calls {step['action']} via {model}"
    return f"{step.get('turn_type')}, {step.get('intent')} via {model}"


def _announce(state: AgentState) -> Union[StatusCode, Tuple[StatusCode, str]]:
    # A rewrite says why the draft went back (a rejection code; clients word it).
    feedback = state.get("feedback")
    return ("rewriting", feedback) if feedback else "thinking"


def make_agent_node(service: KnowledgeAgentService) -> Node:
    @traced("agent", _summary, _announce)
    async def agent(state: AgentState) -> Dict[str, Any]:
        bot = state["bot"]
        start: Dict[str, Any] = {}
        if not state.get("agent_calls"):
            # First step of the run: the working keys the rest of the path reads.
            start = {
                "limits": service.resolve_limits(**bot.get("limits", {})),
                "passages": [],
                "tool_calls": [],
                "revisions": 0,
                "started_at": time.time(),
            }
            omitted = bot.get("gateway_omitted") or []
            if omitted:
                # List tools over the cap of 12 (chunk 6), named once per run.
                start["trace"] = [
                    trace_step(
                        "tools",
                        time.monotonic(),
                        "list tools left out (over 12): " + ", ".join(omitted),
                    )
                ]
        budget = search_budget(state)
        # Past the caps the schema itself offers only `reply`. Searches keep their
        # own limit; gateway tools (chunk 3b) are offered while a tool step of any
        # kind fits, and only when ally-be's request named them.
        offered_searches = search_tools(bot) if budget > 0 else []
        # A gateway tool that failed isn't offered again this run: it's shown as
        # not done, and calling it again would only spend the run's time (each
        # call may wait 5 s) and run it past its cap. One that succeeded may run
        # again within the step cap (chunk 6): find can look at Thursday, then
        # Friday. `hand_over` ends the run when it succeeds.
        failed = {
            call.get("tool")
            for call in state.get("tool_calls") or []
            if not is_search(call) and not call.get("ok")
        }
        offered_gateway = (
            [tool for tool in gateway_tools(bot) if tool.name not in failed]
            if steps_left(state)
            else []
        )
        tools = offered_searches + offered_gateway
        # Sent back for not searching, and still nothing searched: this step can
        # only search. Asking alone was not enough in the eval.
        # A step sent back to search again (SEARCH_AGAIN) is asked to, not forced:
        # forcing the schema made a step that replied anyway fail validation, and
        # the failed run fell back to v1 (chunk 20a-2).
        must_search = bool(
            offered_searches
            and state.get("feedback") in MUST_SEARCH_AFTER
            and not searches(state)
        )
        started_at = state.get("started_at") or start["started_at"]

        async def step_once(force: bool):
            return await conversation.agent_step(
                state["question"],
                passages=state.get("passages") or [],
                # Forced to search: only the searches are offered.
                tools=offered_searches if force else tools,
                tool_budget=budget,
                bot=bot,
                history=recent(state.get("history")),
                searches=state.get("tool_calls") or [],
                feedback=state.get("feedback_text"),
                must_search=force,
                timeout=_time_left(started_at),
            )

        try:
            step, meta = await step_once(must_search)
        except LLMInvocationFailedException:
            # A step that doesn't fit the schema (forced to search but replied, or
            # a search with no query) would fail the run, and v1 would answer.
            # Asked once more, unforced, while there's time for it (chunk 20a-2).
            if _time_left(started_at) < REWRITE_RESERVE_SECONDS:
                raise
            step, meta = await step_once(False)
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


def _time_left(started_at: float) -> float:
    """Seconds left of the run's hard cap, for the model call (at least one)."""
    deadline = started_at + settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS
    return max(deadline - time.time(), 1.0)


def route_after_agent(state: AgentState) -> Literal["tools", "check"]:
    # Only the caps here: a step that was offered a tool runs it, even if the time
    # budget ran out while the model was deciding.
    action = (state.get("agent_step") or {}).get("action", REPLY_ACTION)
    calls = state.get("tool_calls") or []
    if action == REPLY_ACTION or len(calls) >= MAX_TOOL_STEPS:
        return "check"
    if action in {tool.name for tool in gateway_tools(state["bot"])}:
        return "tools"
    if len(searches(state)) < settings.AGENT_RUNTIME.MAX_TOOL_CALLS:
        return "tools"
    return "check"
