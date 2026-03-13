from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.nodes import (
    clear_events_and_detected_data,
    detect_behaviors,
    generate_response,
    process_events,
    resolve_branching_instruction,
    retrieve_knowledge,
    send_event_feedback,
    sync_events_and_behaviors_node,
)
from app.core.graph.state import SimulationState


def build_resolve_branching_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for resolving branching instructions.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836

    The issue: LangGraph LLMAdapter streams all LLM outputs from every node
    in a multi-node graph. By wrapping resolve_branching_instruction in a subgraph,
    its LLM outputs (used for resolving branching instruction tags) won't be
    streamed when subgraphs=False.

    Returns:
        Compiled subgraph that resolves branching instructions
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("resolve_branching_instruction", resolve_branching_instruction)
    subgraph.add_edge(START, "resolve_branching_instruction")
    subgraph.add_edge("resolve_branching_instruction", END)
    return subgraph.compile()


def build_voice_expressions_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for applying voice expressions.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI, preventing the parameters
    dict from appearing in the agent's response.

    Returns:
        Compiled subgraph that applies voice expressions

    Raises:
        ImportError: If apply_voice_expressions cannot be imported
        Exception: If subgraph compilation fails
    """
    from app.core.graph.nodes import apply_voice_expressions

    subgraph = StateGraph(SimulationState)
    subgraph.add_node("apply_voice_expressions", apply_voice_expressions)
    subgraph.add_edge(START, "apply_voice_expressions")
    subgraph.add_edge("apply_voice_expressions", END)
    return subgraph.compile()


def build_retrieve_knowledge_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for knowledge retrieval.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI.

    Although retrieve_knowledge uses with_structured_output, LiveKit's
    LLMAdapter still intercepts the underlying LLM stream before the
    structured-output parser runs. Wrapping in a subgraph is the same
    workaround used for resolve_branching_instruction.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836

    Returns:
        Compiled subgraph that retrieves relevant knowledge context
    """
    subgraph = StateGraph(SimulationState)
    subgraph.add_node("retrieve_knowledge", retrieve_knowledge)
    subgraph.add_edge(START, "retrieve_knowledge")
    subgraph.add_edge("retrieve_knowledge", END)
    return subgraph.compile()


def build_simulation_graph() -> StateGraph[SimulationState]:
    """
    Build the LangGraph state graph.

    Flow:
    1. START splits into three parallel paths:
       - detect_behaviors: Detects behaviors from behavior instructions
       - process_events: Detects events, updates EventRegistry
       - retrieve_knowledge: Retrieves relevant knowledge context (as subgraph)
    2. sync_events_and_behaviors_node:
        Convergence point for all three parallel paths
    3. resolve_branching_instruction: Resolves branching instructions with LLM calls
       (as subgraph)
    4. generate_response: Generates LLM response based on detected events
    5. apply_voice_expressions: Applies voice expression parameters and text enhancement
       (as subgraph)
    6. send_event_feedback: Sends event and behavior feedback to the UI and clears
       transient state. Separated from generate_response so the core nodes can be
       reused by the report graph without UI concerns.

    Note: resolve_branching_instruction, retrieve_knowledge, and
    apply_voice_expressions are subgraphs to prevent their LLM outputs from
    being streamed. With subgraphs=False (default in LLMAdapter), only root
    graph outputs are streamed.

    This is a workaround for LiveKit issue #2836:
    https://github.com/livekit/agents/issues/2836
    """
    # Build the main graph
    graph = StateGraph(SimulationState)
    graph.add_node("process_events", process_events)

    # Build the resolve_branching_instruction subgraph and add it as a node
    # This prevents its LLM outputs (for resolving branching tags) from being streamed
    resolve_branching_subgraph = build_resolve_branching_subgraph()
    graph.add_node("resolve_branching_instruction", resolve_branching_subgraph)

    # Add generate_response as a regular node (its LLM outputs WILL be streamed)
    graph.add_node("generate_response", generate_response)

    # Add detect_behaviors as a regular node
    # This runs in parallel with process_events from START
    graph.add_node("detect_behaviors", detect_behaviors)

    # Build the retrieve_knowledge subgraph and add it as a node
    # This prevents its LLM outputs from being streamed to TTS/UI
    retrieve_knowledge_subgraph = build_retrieve_knowledge_subgraph()
    graph.add_node("retrieve_knowledge", retrieve_knowledge_subgraph)

    # sync_events_and_behaviors_node acts as a convergence point for
    # detect_behaviors, process_events, and retrieve_knowledge
    # before resolve_branching_instruction
    graph.add_node("sync_events_and_behaviors_node", sync_events_and_behaviors_node)

    # send_event_feedback runs last — sends event scores/feedback to UI.
    # Kept separate from generate_response so that node stays reusable
    # for contexts that don't need UI feedback (e.g. report generation).
    graph.add_node("send_event_feedback", send_event_feedback)

    # START splits into three parallel paths
    graph.add_edge(START, "detect_behaviors")
    graph.add_edge(START, "process_events")
    graph.add_edge(START, "retrieve_knowledge")

    # All three paths converge at sync_events_and_behaviors_node
    graph.add_edge("detect_behaviors", "sync_events_and_behaviors_node")
    graph.add_edge("process_events", "sync_events_and_behaviors_node")
    graph.add_edge("retrieve_knowledge", "sync_events_and_behaviors_node")

    # Continue with sequential flow
    graph.add_edge("sync_events_and_behaviors_node", "resolve_branching_instruction")
    graph.add_edge("resolve_branching_instruction", "generate_response")
    graph.add_edge("resolve_branching_instruction", "send_event_feedback")

    # Build the apply_voice_expressions subgraph and add it as a node
    # This prevents its LLM outputs (for voice expression parameters) from being
    # streamed
    voice_expressions_subgraph = build_voice_expressions_subgraph()
    graph.add_node("apply_voice_expressions", voice_expressions_subgraph)

    graph.add_edge("generate_response", "apply_voice_expressions")
    graph.add_edge("apply_voice_expressions", END)
    graph.add_edge("send_event_feedback", END)

    return graph


def _build_report_graph() -> StateGraph:
    """
    Construct the report-specific StateGraph (topology only, not compiled).

    Reuses the core simulation nodes (process_events, resolve_branching_instruction,
    generate_response, detect_behaviors, retrieve_knowledge) but omits the
    LiveKit/TTS/UI-only nodes:
    - apply_voice_expressions  (TTS voice parameter injection)
    - send_event_feedback  (UI score/emoji feedback sending)

    Uses SimulationState so nodes are shared without any adaptation.
    The UI-only fields (non_branching_feedback_data, feedback_to_send,
    behavior_feedback_data) carry their defaults and are simply never sent to UI.

    Flow:
        START → [process_events, retrieve_knowledge (subgraph),
        detect_behaviors] (parallel)
              → sync_events_and_behaviors_node
              → resolve_branching_instruction (subgraph)
              → generate_response
              → clear_events_and_detected_data → END

    Not called directly — use ``get_report_graph()`` which caches the result.
    """
    graph = StateGraph(SimulationState)

    graph.add_node("process_events", process_events)

    # Subgraph prevents streaming of branching resolution LLM text output
    resolve_branching_subgraph = build_resolve_branching_subgraph()
    graph.add_node("resolve_branching_instruction", resolve_branching_subgraph)

    # Subgraph prevents streaming of knowledge retrieval LLM output
    retrieve_knowledge_subgraph = build_retrieve_knowledge_subgraph()
    graph.add_node("retrieve_knowledge", retrieve_knowledge_subgraph)

    graph.add_node("generate_response", generate_response)

    # detect_behaviors runs in parallel with process_events
    # and retrieve_knowledge from START
    graph.add_node("detect_behaviors", detect_behaviors)

    # Sync node for fan-in of all three parallel paths before
    # resolve_branching_instruction
    graph.add_node("sync_events_and_behaviors_node", sync_events_and_behaviors_node)

    # Add clear_events_and_detected_data node to clean up event data
    graph.add_node("clear_events_and_detected_data", clear_events_and_detected_data)

    # START fans out to all three parallel paths
    graph.add_edge(START, "process_events")
    graph.add_edge(START, "retrieve_knowledge")
    graph.add_edge(START, "detect_behaviors")

    # All three converge at sync node
    graph.add_edge("process_events", "sync_events_and_behaviors_node")
    graph.add_edge("retrieve_knowledge", "sync_events_and_behaviors_node")
    graph.add_edge("detect_behaviors", "sync_events_and_behaviors_node")

    graph.add_edge("sync_events_and_behaviors_node", "resolve_branching_instruction")
    graph.add_edge("resolve_branching_instruction", "generate_response")
    graph.add_edge("generate_response", "clear_events_and_detected_data")

    # Clear events data and lead to END
    graph.add_edge("clear_events_and_detected_data", END)

    return graph


# Module-level cache: the graph topology is static, so it is built once and
# reused. Only .compile(checkpointer=...) is called per-report, which is cheap.
_report_graph: StateGraph = _build_report_graph()


def get_report_graph() -> StateGraph:
    """Return the cached report StateGraph (built once at import time)."""
    return _report_graph
