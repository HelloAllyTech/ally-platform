"""The agent graph and how one run is invoked.

    START → translate → retrieve → gate ─(decline)→ finalize → END
                                        └─(continue)→ select → write → check → finalize

Parity mode: the same steps, in the same order, as `/knowledge-agent/answer`.
"""

from __future__ import annotations

from functools import lru_cache
from typing import Any, Dict, List, Optional

from langgraph.checkpoint.base import BaseCheckpointSaver
from langgraph.graph import END, START, StateGraph
from langgraph.graph.state import CompiledStateGraph
from langsmith.run_helpers import tracing_context

from app.core.agent_runtime.checkpointer import get_checkpointer
from app.core.agent_runtime.nodes import (
    make_check_node,
    make_finalize_node,
    make_gate_node,
    make_retrieve_node,
    make_select_node,
    make_translate_node,
    make_write_node,
    route_after_gate,
)
from app.core.agent_runtime.state import RUN_SCOPED_KEYS, AgentState
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

    graph.add_edge(START, "translate")
    graph.add_edge("translate", "retrieve")
    graph.add_edge("retrieve", "gate")
    graph.add_conditional_edges("gate", route_after_gate, ["select", "finalize"])
    graph.add_edge("select", "write")
    graph.add_edge("write", "check")
    graph.add_edge("check", "finalize")
    graph.add_edge("finalize", END)
    return graph.compile(checkpointer=checkpointer)


@lru_cache(maxsize=1)
def get_agent_graph() -> CompiledStateGraph:
    """Compiled once, on first use, against whichever checkpointer startup opened."""
    # Imported here: dependencies imports the API layer's services, and this module
    # must stay importable on its own.
    from app.core.dependencies import _get_knowledge_agent_service_cached

    return build_graph(_get_knowledge_agent_service_cached(), get_checkpointer())


async def run_agent(
    graph: CompiledStateGraph,
    *,
    run_id: str,
    conversation_id: str,
    chatbot_id: Optional[str],
    question: str,
    history: List[Dict[str, str]],
    bot: Dict[str, Any],
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
    conversation_id: str, run_id: str, graph: Optional[CompiledStateGraph] = None
) -> Optional[Dict[str, Any]]:
    """The final stored state of one run in a conversation, or None.

    Internal for now; "Why?" (chunk 10) puts a route on it.
    """
    graph = graph or get_agent_graph()
    config = {"configurable": {"thread_id": conversation_id}}
    # Newest first, so the first checkpoint of this run is its final state.
    async for snapshot in graph.aget_state_history(config):
        if snapshot.values.get("run_id") == run_id:
            return dict(snapshot.values)
    return None
