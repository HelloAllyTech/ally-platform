"""What one agent run may still do: searches left, time left, rewrites allowed, and
how much of the conversation the agent reads. Read by the agent and check nodes."""

from __future__ import annotations

import asyncio
import time
from contextvars import ContextVar
from typing import Any, Dict, List, Optional, Sequence

from app.core.agent_runtime.check import Rejection
from app.core.agent_runtime.state import AgentState
from app.core.config import settings

#: Refusals after which, if nothing has been searched, the next step must search.
MUST_SEARCH_AFTER = (Rejection.UNCITED, Rejection.SEARCH_FIRST)

#: Rewrites allowed per message. One is enough to turn an uncited claim into an
#: honest reply; more would only add latency.
MAX_REVISIONS = 1

#: Time a send-back needs before the run's hard cap (RUN_TIMEOUT_SECONDS): one
#: model step for a rewrite; a search and a step to search again (chunk 20a-2).
#: With less left, the checked draft is final. A rewrite cut off by the cap fails
#: the whole run, and ally-be's v1 fallback then answers 7-10 s later.
REWRITE_RESERVE_SECONDS = 8.0
SEARCH_AGAIN_RESERVE_SECONDS = 11.0


def recent(
    history: Optional[Sequence[Dict[str, str]]],
) -> Optional[List[Dict[str, str]]]:
    """The last MAX_HISTORY_MESSAGES of the conversation; None when empty."""
    keep = settings.AGENT_RUNTIME.MAX_HISTORY_MESSAGES
    return list(history or [])[-keep:] if history and keep else None


def over_time(state: AgentState) -> bool:
    """Whether the run has used its time budget (RUN_BUDGET_SECONDS)."""
    started = state.get("started_at")
    return bool(
        started and time.time() - started > settings.AGENT_RUNTIME.RUN_BUDGET_SECONDS
    )


def wrote(state: AgentState) -> bool:
    """Whether the run has booked or changed something in a list (chunk 8a)."""
    return any(
        call.get("ok") and call.get("list_kind") in ("create", "update")
        for call in state.get("tool_calls") or []
    )


#: This run's hard cap in seconds (chunk H1): the request's `run_timeout_s`, set by
#: the runner; RUN_TIMEOUT_SECONDS when the request names none.
RUN_CAP_S: ContextVar[Optional[float]] = ContextVar("agent_run_cap_s", default=None)


def base_cap() -> float:
    """The run's cap before any write extra."""
    return RUN_CAP_S.get() or settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS


def run_cap(state: AgentState) -> float:
    """The run's hard cap (`base_cap`), and RUN_WRITE_EXTRA_SECONDS more once it has
    written (chunk 8a; 0 since chunk H1)."""
    extra = settings.AGENT_RUNTIME.RUN_WRITE_EXTRA_SECONDS if wrote(state) else 0.0
    return base_cap() + extra


def time_left(state: AgentState) -> float:
    """Seconds before the run's hard cap (`run_cap`)."""
    started = state.get("started_at")
    if not started:
        return run_cap(state)
    return run_cap(state) - (time.time() - started)


#: The run's `asyncio.timeout`, so a write can extend it (chunk 8a).
RUN_DEADLINE: ContextVar[Optional[asyncio.Timeout]] = ContextVar(
    "agent_run_deadline", default=None
)


def extend_after_write(started_at: Optional[float]) -> None:
    """Move the run's hard cap to RUN_TIMEOUT + RUN_WRITE_EXTRA seconds after its
    start, once it has written. Never shortens it."""
    deadline = RUN_DEADLINE.get()
    if deadline is None or started_at is None:
        return
    extra = settings.AGENT_RUNTIME.RUN_WRITE_EXTRA_SECONDS
    if extra <= 0:
        return
    loop = asyncio.get_running_loop()
    target = loop.time() + (base_cap() + extra - (time.time() - started_at))
    current = deadline.when()
    if current is None or target > current:
        deadline.reschedule(target)


def can_send_back(state: AgentState, rejection: Rejection) -> bool:
    """Whether a refused draft can still be rewritten inside the hard cap."""
    reserve = (
        SEARCH_AGAIN_RESERVE_SECONDS
        if rejection == Rejection.SEARCH_AGAIN
        else REWRITE_RESERVE_SECONDS
    )
    return (
        (state.get("revisions") or 0) < MAX_REVISIONS
        and not over_time(state)
        and time_left(state) >= reserve
    )


#: Tool steps of any kind in one run (chunk 3b): searches (still capped by
#: MAX_TOOL_CALLS) and gateway tools together.
MAX_TOOL_STEPS = 4


def is_search(record: Dict[str, Any]) -> bool:
    """A record of a search, not of a gateway tool (chunk 3b)."""
    return record.get("kind") != "gateway"


def searches(state: AgentState) -> List[Dict[str, Any]]:
    """The run's search records, in order."""
    return [call for call in state.get("tool_calls") or [] if is_search(call)]


def steps_left(state: AgentState) -> bool:
    """Whether another tool step of any kind fits: under the 4-step cap and the
    time budget."""
    return len(state.get("tool_calls") or []) < MAX_TOOL_STEPS and not over_time(state)


def search_budget(state: AgentState) -> int:
    """Searches left: none past the cap, past the time budget, or once a search
    added nothing new (another phrasing of the same miss only costs time). Gateway
    tools don't count, and "nothing new" ends searching only."""
    calls = searches(state)
    if len(state.get("tool_calls") or []) >= MAX_TOOL_STEPS:
        return 0
    if calls and not calls[-1].get("added") and not calls[-1].get("refused"):
        return 0
    if over_time(state):
        return 0
    # Another search needs time for itself and the reply after it (chunk 20a-2):
    # one started late ran the reply past the hard cap, and v1 answered instead.
    if calls and time_left(state) < SEARCH_AGAIN_RESERVE_SECONDS:
        return 0
    return max(0, settings.AGENT_RUNTIME.MAX_TOOL_CALLS - len(calls))


#: The name before chunk 3b, when every tool was a search.
tool_budget = search_budget
