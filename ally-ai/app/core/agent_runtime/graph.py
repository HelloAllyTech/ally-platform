"""The agent graph and how one run is invoked.

One graph serves every bot; `bot.features.agent` picks the path at START.

Parity mode (agent off): the same steps, in the same order, as
`/knowledge-agent/answer`.

    START → translate → retrieve → gate ─(decline)→ finalize → END
                                        └─(continue)→ select → write → check → finalize

Conversational agent (agent on): the agent reads the turn and decides whether to
search; a draft the check refuses goes back to it once.

    START → agent ─(tool call, budget left)→ tools → agent
                  └─(reply)→ agent_check ─(refused, first time)→ agent
                                        └─(otherwise)→ finalize → END
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langsmith.run_helpers import tracing_context

from app.core.agent_runtime.checkpointer import (
    close_checkpointer,
    get_checkpointer,
    open_checkpointer,
)
from app.core.agent_runtime.nodes import (
    make_agent_check_node,
    make_agent_node,
    make_check_node,
    make_finalize_node,
    make_gate_node,
    make_retrieve_node,
    make_select_node,
    make_tools_node,
    make_translate_node,
    make_write_node,
    route_after_agent,
    route_after_check,
    route_after_gate,
)
from app.core.agent_runtime.state import RUN_SCOPED_KEYS, AgentState, BotConfig
from app.core.agent_runtime.trace import summarise_run
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.utils.logger import get_logger

logger = get_logger(__name__)


def build_graph(
    service: KnowledgeAgentService, checkpointer: Optional[BaseCheckpointSaver]
) -> CompiledStateGraph:
    graph = StateGraph(AgentState)
    graph.add_node("translate", make_translate_node(service))
    graph.add_node("retrieve", make_retrieve_node(service))
    graph.add_node("gate", make_gate_node(service))
    graph.add_node("select", make_select_node(service))
    graph.add_node("write", make_write_node(service))
    graph.add_node("check", make_check_node(service))
    graph.add_node("finalize", make_finalize_node(service))

    graph.add_node("agent", make_agent_node(service))
    graph.add_node("tools", make_tools_node(service))
    graph.add_node("agent_check", make_agent_check_node(service))

    graph.add_conditional_edges(START, route_at_start, ["translate", "agent"])
    graph.add_edge("translate", "retrieve")
    graph.add_edge("retrieve", "gate")
    graph.add_conditional_edges("gate", route_after_gate, ["select", "finalize"])
    graph.add_edge("select", "write")
    graph.add_edge("write", "check")
    graph.add_edge("check", "finalize")

    graph.add_conditional_edges("agent", route_after_agent, ["tools", "agent_check"])
    graph.add_edge("tools", "agent")
    graph.add_conditional_edges("agent_check", route_after_check, ["agent", "finalize"])

    graph.add_edge("finalize", END)
    return graph.compile(checkpointer=checkpointer)


def route_at_start(state: AgentState) -> str:
    """The conversational agent when the bot has it on; the parity path otherwise."""
    features = (state.get("bot") or {}).get("features") or {}
    return "agent" if features.get("agent") else "translate"


@lru_cache(maxsize=1)
def get_agent_graph(service: KnowledgeAgentService) -> CompiledStateGraph:
    """Compiled once, on first use, against whichever checkpointer is open then.

    `open_agent_runtime` and `close_agent_runtime` clear it, so a graph compiled
    before startup (or after shutdown) never keeps the wrong checkpointer.
    """
    return build_graph(service, get_checkpointer())


async def open_agent_runtime() -> None:
    """Startup: open the checkpointer, and compile the graph against it on first use."""
    await open_checkpointer()
    get_agent_graph.cache_clear()


async def close_agent_runtime() -> None:
    """Shutdown: close the checkpointer and drop the graph that held it."""
    await close_checkpointer()
    get_agent_graph.cache_clear()


async def run_agent(
    graph: CompiledStateGraph,
    *,
    run_id: str,
    conversation_id: str,
    chatbot_id: Optional[str],
    question: str,
    history: List[Dict[str, str]],
    bot: BotConfig,
) -> AgentState:
    """Run the graph once for one message. Returns the final state."""
    inputs: Dict[str, Any] = {key: None for key in RUN_SCOPED_KEYS}
    inputs.update(
        run_id=run_id,
        chatbot_id=chatbot_id,
        conversation_id=conversation_id,
        question=question,
        history=history,
        bot=bot,
        trace=None,  # resets the trace (see add_trace)
    )
    config = {
        "configurable": {"thread_id": conversation_id},
        "run_name": "agent_run",
        "metadata": {"run_id": run_id, "chatbot_id": chatbot_id},
    }
    # Never traced to LangSmith. The knowledge path this replaces sends nothing
    # there (its model calls use the provider SDKs directly), and a traced graph run
    # would upload the question and passages — a new PHI destination.
    with tracing_context(enabled=False):
        state = await graph.ainvoke(
            inputs, config, durability=settings.AGENT_RUNTIME.DURABILITY
        )
    logger.info(
        "Agent run %s: %s (%s)",
        run_id,
        (state.get("result") or {}).get("intent"),
        summarise_run(state.get("trace") or []),
    )
    return state


async def get_run_state(
    conversation_id: str, run_id: str, *, graph: CompiledStateGraph
) -> Optional[Dict[str, Any]]:
    """The final stored state of one run in a conversation, or None.

    Internal for now; "Why?" (chunk 10) puts a route on it.
    """
    config = {"configurable": {"thread_id": conversation_id}}
    # Newest first, so the first checkpoint of this run is its final state.
    async for snapshot in graph.aget_state_history(config):
        if snapshot.values.get("run_id") == run_id:
            return dict(snapshot.values)
    return None
