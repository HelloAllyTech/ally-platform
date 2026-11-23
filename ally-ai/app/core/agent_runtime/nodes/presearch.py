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


#: Share of a message's letters outside the Latin script above which it isn't
#: searched as written (Q4).
NON_LATIN_SHARE = 0.3


def mostly_non_latin(text: str) -> bool:
    """Whether most of a message's letters are in another script (Devanagari, Tamil,
    Bengali...). Hinglish, written in Latin letters, is not."""
    letters = [ch for ch in text if ch.isalpha()]
    if not letters:
        return False
    other = sum(1 for ch in letters if ord(ch) > 0x024F)
    return other / len(letters) > NON_LATIN_SHARE


def presearch_wanted(state: AgentState) -> bool:
    if not settings.AGENT_RUNTIME.PRESEARCH:
        return False
    question = (state.get("question") or "").strip()
    if not question or is_plain_yes(question):
        return False
    # Q4: the documents are searched with an English query (the tool's contract). A
    # message in Hindi, Tamil or Bengali searched as written found nothing above the
    # decline threshold, so the agent saw no passages and said it didn't know (8 of
    # the 17 non-English misses at the Q4 baseline). The agent writes the query.
    if mostly_non_latin(question):
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
