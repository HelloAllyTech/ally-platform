"""What one agent run may still do: searches left, time left, rewrites allowed, and
how much of the conversation the agent reads. Read by the agent and check nodes."""

from __future__ import annotations

import time
from typing import Dict, List, Optional, Sequence

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


def time_left(state: AgentState) -> float:
    """Seconds before the run's hard cap (RUN_TIMEOUT_SECONDS)."""
    started = state.get("started_at")
    if not started:
        return settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS
    return settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS - (time.time() - started)


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


def tool_budget(state: AgentState) -> int:
    """Searches left: none past the cap, past the time budget, or once a search
    added nothing new (another phrasing of the same miss only costs time)."""
    calls = state.get("tool_calls") or []
    if calls and not calls[-1].get("added") and not calls[-1].get("refused"):
        return 0
    if over_time(state):
        return 0
    # Another search needs time for itself and the reply after it (chunk 20a-2):
    # one started late ran the reply past the hard cap, and v1 answered instead.
    if calls and time_left(state) < SEARCH_AGAIN_RESERVE_SECONDS:
        return 0
    return max(0, settings.AGENT_RUNTIME.MAX_TOOL_CALLS - len(calls))
