"""What one agent run may still do: searches left, time left, rewrites allowed, and
how much of the conversation the agent reads. Read by the agent and check nodes."""

from __future__ import annotations

import time
from typing import Dict, List, Optional, Sequence

from app.core.agent_runtime.state import AgentState
from app.core.config import settings

#: Refusals after which, if nothing has been searched, the next step must search.
MUST_SEARCH_AFTER = ("uncited", "search_first")

#: Rewrites allowed per message. One is enough to turn an uncited claim into an
#: honest reply; more would only add latency.
MAX_REVISIONS = 1


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


def tool_budget(state: AgentState) -> int:
    """Searches left: none past the cap, past the time budget, or once a search
    added nothing new (another phrasing of the same miss only costs time)."""
    calls = state.get("tool_calls") or []
    if calls and not calls[-1].get("added") and not calls[-1].get("refused"):
        return 0
    if over_time(state):
        return 0
    return max(0, settings.AGENT_RUNTIME.MAX_TOOL_CALLS - len(calls))
