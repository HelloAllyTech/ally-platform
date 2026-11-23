"""Agent: one model call that reads the conversation and either asks for a tool or
replies. It is the run's first step: there is no classifier or up-front search
before it, so whether to search, and for what, is its decision."""

from __future__ import annotations

import time
from typing import Any, Dict, Literal, Tuple, Union

from app.core.agent_runtime import activity, conversation, memory
from app.core.agent_runtime.budget import (
    MAX_REVISIONS,
    MAX_TOOL_STEPS,
    MUST_SEARCH_AFTER,
    REWRITE_RESERVE_SECONDS,
    is_search,
    recent,
    run_cap,
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
from app.core.llm_usage.scope import set_step
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
        # Usage attribution (CR1): this node's model calls are agent step N of the
        # run. Set for this node's context only; without the X-Ally-Usage header
        # the run's own ids start the scope.
        set_step(
            (state.get("agent_calls") or 0) + 1,
            run_id=state.get("run_id"),
            chatbot_id=state.get("chatbot_id"),
            conversation_id=state.get("conversation_id"),
        )
        start: Dict[str, Any] = {}
        # First step of the run, unless the search before it (chunk H1) set it up.
        if not state.get("agent_calls") and not state.get("started_at"):
            start = first_step_keys(service, state)
        budget = search_budget(state)
        # Past the caps the schema itself offers only `reply`. Searches keep their
        # own limit; gateway tools (chunk 3b) are offered while a tool step of any
        # kind fits, and only when ally-be's request named them.
        offered_searches = search_tools(bot) if budget > 0 else []
        # A gateway tool that failed isn't offered again this run: it's shown as
        # not done, and calling it again would only spend the run's time (each
        # call may wait 5 s) and run it past its cap. A single `invalid_value` (a
        # shortened id) gets one more try (chunk 6b). One that succeeded may run
        # again within the step cap (chunk 6): find can look at Thursday, then
        # Friday. `hand_over` ends the run when it succeeds.
        failed = failed_tools(state) | answered_finds(state)
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
                timeout=_time_left(started_at, state),
            )

        final_draft: Dict[str, Any] = {}
        try:
            step, meta = await step_once(must_search)
        except LLMInvocationFailedException:
            # A step that doesn't fit the schema (forced to search but replied, or
            # a search with no query) would fail the run, and v1 would answer.
            # Asked once more, unforced, while there's time for it (chunk 20a-2).
            if _time_left(started_at, state) >= REWRITE_RESERVE_SECONDS:
                step, meta = await step_once(False)
            elif must_search and state.get("agent_step"):
                # Forced to search, it replied anyway, and there's no time to ask
                # again (chunk 6b): the reply it stands by is the draft it was sent
                # back for. That draft goes through the check once more, as final,
                # and the run never fails for it.
                step = dict(state["agent_step"])
                meta = dict(state.get("agent_meta") or {})
                final_draft = {"revisions": MAX_REVISIONS}
            else:
                raise
        # What the step asked to remember (chunk 8a): collected, returned with the
        # result, never stored here. The trace gets counts, never the text.
        # A draft reused as final (above) had its memory collected already.
        writes = (
            list(state.get("memory_writes") or [])
            if final_draft
            else memory.collect(
                state.get("memory_writes") or [], step, memory.remember_mode(bot)
            )
        )
        if (step.get("action") or REPLY_ACTION) == REPLY_ACTION:
            activity.writing(bot)  # the live step "Writing a reply…" (chunk 6b)
        added = writes[len(state.get("memory_writes") or []) :]
        if added:
            start["trace"] = [
                *(start.get("trace") or []),
                trace_step("remember", time.monotonic(), memory.trace_summary(added)),
            ]
        return {
            **start,
            **final_draft,
            "memory_writes": writes,
            "agent_step": json_safe(step),
            "agent_meta": json_safe(meta),
            "agent_calls": (state.get("agent_calls") or 0) + 1,
            "turn_type": step.get("turn_type") or "question",
            "language": (step.get("language") or "en").strip() or "en",
            "feedback": None,
            "feedback_text": None,
        }

    return agent


#: A failure that a second call may fix (chunk 6b): a value the tool refused as
#: written, most often an id the model shortened. The tool stays offered once more.
RETRYABLE_ERRORS = frozenset({"invalid_value"})


def failed_tools(state: AgentState) -> set:
    """The gateway tools not offered again this run: any that failed, except one
    whose only failure so far is a single retryable error (`RETRYABLE_ERRORS`)."""
    failures: Dict[str, list] = {}
    for call in state.get("tool_calls") or []:
        if not is_search(call) and not call.get("ok"):
            failures.setdefault(call.get("tool"), []).append(call.get("error"))
    return {
        tool
        for tool, errors in failures.items()
        if not (len(errors) == 1 and errors[0] in RETRYABLE_ERRORS)
    }


def answered_finds(state: AgentState) -> set:
    """Finds that already returned the nearest entries this run (chunk 6b, item 3):
    nothing was at the time asked, and the nearest (the latest that day, the next
    day's same stretch) are the answer. Looking again only cost a model step and ran
    "Thursday evening" past the run's cap."""
    return {
        call.get("tool")
        for call in state.get("tool_calls") or []
        if call.get("list_kind") == "find" and call.get("ok") and call.get("nearest")
    }


def first_step_keys(
    service: KnowledgeAgentService, state: AgentState
) -> Dict[str, Any]:
    """The working keys a run's first step sets, which the rest of the path reads."""
    bot = state["bot"]
    start: Dict[str, Any] = {
        "limits": service.resolve_limits(**bot.get("limits", {})),
        # The previous message's list entries (chunk 6b), so a confirmation can book
        # without looking the slot up again.
        "passages": list(state.get("carried_records") or []),
        "tool_calls": [],
        "activity": [],
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
    return start


def _time_left(started_at: float, state: AgentState) -> float:
    """Seconds left of the run's hard cap, for the model call (at least one). The cap
    grows once the run has written (chunk 8a, budget.run_cap)."""
    deadline = started_at + run_cap(state)
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
