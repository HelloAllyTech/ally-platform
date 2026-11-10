"""The agent graph and how one run is invoked.

One loop serves every bot: the agent reads the turn and decides whether to search;
a draft the check refuses goes back to it once.

    START → agent ─(tool call, budget left)→ tools → agent
                  └─(reply)→ check ─(refused, first time)→ agent
                                   └─(otherwise)→ END
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Callable, Dict, List, Optional

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
    make_tools_node,
    route_after_agent,
    route_after_check,
)
from app.core.agent_runtime.state import RUN_SCOPED_KEYS, AgentState, BotConfig
from app.core.agent_runtime.trace import summarise_run
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Receives each live event of a run: (`status` | `step`, its data).
OnEvent = Callable[[str, Dict[str, Any]], None]


def build_graph(
    service: KnowledgeAgentService, checkpointer: Optional[BaseCheckpointSaver]
) -> CompiledStateGraph:
    graph = StateGraph(AgentState)
    graph.add_node("agent", make_agent_node(service))
    graph.add_node("tools", make_tools_node(service))
    graph.add_node("check", make_agent_check_node(service))

    graph.add_edge(START, "agent")
    graph.add_conditional_edges("agent", route_after_agent, ["tools", "check"])
    graph.add_edge("tools", "agent")
    graph.add_conditional_edges("check", route_after_check, ["agent", END])
    return graph.compile(checkpointer=checkpointer)


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
    on_event: Optional[OnEvent] = None,
) -> AgentState:
    """Run the graph once for one message. Returns the final state.

    `on_event` receives the run's live `status` and `step` events as they happen
    (the streamed endpoint). Without it nothing is streamed, and the run is the
    same either way.
    """
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
    # recursion_limit is LangGraph's default of 25 supersteps. A run takes at most
    # about 20: MAX_TOOL_CALLS (bounded at 8) agent→tools rounds, then the agent,
    # check and one rewrite. Raising that bound means setting
    # recursion_limit here too, or the run fails with GraphRecursionError (a 500).
    # Never traced to LangSmith. The knowledge path this replaces sends nothing
    # there (its model calls use the provider SDKs directly), and a traced graph run
    # would upload the question and passages — a new PHI destination.
    # What `ainvoke` does (the last "values" chunk is the final state), plus the
    # nodes' custom events when someone is listening.
    modes = ["values", "custom"] if on_event else ["values"]
    state: AgentState = {}  # type: ignore[typeddict-item]
    with tracing_context(enabled=False):
        async for mode, chunk in graph.astream(
            inputs,
            config,
            stream_mode=modes,
            durability=settings.AGENT_RUNTIME.DURABILITY,
        ):
            if mode == "values":
                state = chunk
            elif on_event:
                on_event(chunk["event"], chunk["data"])
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

    Only tests call it today; "Why?" (chunk 16b) will put a route on it.
    """
    config = {"configurable": {"thread_id": conversation_id}}
    # Newest first, so the first checkpoint of this run is its final state.
    async for snapshot in graph.aget_state_history(config):
        if snapshot.values.get("run_id") == run_id:
            return dict(snapshot.values)
    return None
