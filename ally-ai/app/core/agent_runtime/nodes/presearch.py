"""Search before the first model call (chunk H1 Part C).

A plain question used to take two model calls in a row: one only to decide to
search (about 4 s), then one to reply. Searching the question first puts the
passages in the first call, which can reply at once; it can still search again
with other words, within the usual budget.

Skipped when the bot can't search, for an empty message, and for a plain yes
(that turn confirms a booking; the passages would only cost time).
"""

from __future__ import annotations

from typing import Any, Dict, Literal

from app.core.agent_runtime.nodes.agent import first_step_keys
from app.core.agent_runtime.nodes.tools import make_tools_node
from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.tools import search_tools
from app.core.agent_runtime.tools.confirmed import is_plain_yes
from app.core.agent_runtime.tools.search_knowledge import NAME as SEARCH
from app.core.agent_runtime.trace import Node
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService

#: The question as the search query, at most this long.
MAX_QUERY_CHARS = 300


def presearch_wanted(state: AgentState) -> bool:
    if not settings.AGENT_RUNTIME.PRESEARCH:
        return False
    question = (state.get("question") or "").strip()
    if not question or is_plain_yes(question):
        return False
    return any(tool.name == SEARCH for tool in search_tools(state["bot"]))


def route_from_start(state: AgentState) -> Literal["presearch", "agent"]:
    return "presearch" if presearch_wanted(state) else "agent"


def make_presearch_node(service: KnowledgeAgentService) -> Node:
    tools = make_tools_node(service)

    async def presearch(state: AgentState) -> Dict[str, Any]:
        start = first_step_keys(service, state)
        step = {
            "action": SEARCH,
            SEARCH: {"query": (state.get("question") or "")[:MAX_QUERY_CHARS]},
        }
        update = await tools({**state, **start, "agent_step": step})
        return {
            **start,
            **update,
            "trace": [*(start.get("trace") or []), *(update.get("trace") or [])],
        }

    return presearch
