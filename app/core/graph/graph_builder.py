from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.nodes import (
    clear_events_and_detected_data,
    detect_behaviors,
    generate_response,
    process_events,
    resolve_branching_instruction,
    send_event_feedback,
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


def build_simulation_graph() -> StateGraph[SimulationState]:
    """
    Build the LangGraph state graph.

    Flow:
    1. process_events: Detects events, updates EventRegistry
    2. resolve_branching_instruction: Resolves branching instructions with LLM calls
       (as subgraph)
    3. generate_response + detect_behaviors (parallel):
       - generate_response: Generates LLM response based on detected events
       - detect_behaviors: Detects behaviors from behavior instructions
    4. apply_voice_expressions: Applies voice expression parameters and text enhancement
       (as subgraph)
    5. send_event_feedback: Sends event and behavior feedback to the UI and clears
       transient state. Separated from generate_response so the core nodes (1-3)
       can be reused by the report graph without UI concerns.

    Note: resolve_branching_instruction and apply_voice_expressions are subgraphs
    to prevent their LLM outputs from being streamed. With subgraphs=False
    (default in LLMAdapter), only root graph outputs are streamed.

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
    # This runs in parallel with generate_response after resolve_branching_instruction
    graph.add_node("detect_behaviors", detect_behaviors)

    # send_event_feedback runs last — sends event scores/feedback to UI.
    # Kept separate from generate_response so that node stays reusable
    # for contexts that don't need UI feedback (e.g. report generation).
    graph.add_node("send_event_feedback", send_event_feedback)

    graph.add_edge(START, "process_events")
    graph.add_edge(START, "detect_behaviors")

    graph.add_edge("process_events", "resolve_branching_instruction")

    graph.add_edge("resolve_branching_instruction", "generate_response")

    # Build the apply_voice_expressions subgraph and add it as a node
    # This prevents its LLM outputs (for voice expression parameters) from being
    # streamed
    voice_expressions_subgraph = build_voice_expressions_subgraph()
    graph.add_node("apply_voice_expressions", voice_expressions_subgraph)

    # Fan-in: [generate_response, detect_behaviors] → apply_voice_expressions
    graph.add_edge("generate_response", "apply_voice_expressions")
    graph.add_edge("detect_behaviors", "send_event_feedback")

    graph.add_edge("apply_voice_expressions", "send_event_feedback")
    graph.add_edge("send_event_feedback", END)

    return graph


def build_report_graph() -> StateGraph:
    """
    Build the report-specific LangGraph.

    Reuses the core simulation nodes (process_events, resolve_branching_instruction,
    generate_response, detect_behaviors) but omits the LiveKit/TTS/UI-only nodes:
    - apply_voice_expressions  (TTS voice parameter injection)
    - send_event_feedback  (UI score/emoji feedback sending)

    Uses SimulationState so nodes are shared without any adaptation.
    The UI-only fields (non_branching_feedback_data, feedback_to_send,
    behavior_feedback_data) carry their defaults and are simply never sent to UI.

    Flow:
        START → process_events → resolve_branching_instruction
              → [generate_response, detect_behaviors] (parallel)
              → clear_events_and_detected_data → END
    """
    graph = StateGraph(SimulationState)

    graph.add_node("process_events", process_events)

    # Reuse the same resolve_branching_instruction subgraph so that LLM
    # calls for tag resolution are never streamed (same reason as main graph).
    resolve_branching_subgraph = build_resolve_branching_subgraph()
    graph.add_node("resolve_branching_instruction", resolve_branching_subgraph)

    graph.add_node("generate_response", generate_response)

    # Add detect_behaviors as a regular node
    # This runs in parallel with generate_response after resolve_branching_instruction
    # Behavior detection is valuable for report generation to track user behaviors
    graph.add_node("detect_behaviors", detect_behaviors)

    # Add clear_events_and_detected_data node to clean up event data
    graph.add_node("clear_events_and_detected_data", clear_events_and_detected_data)

    graph.add_edge(START, "process_events")
    graph.add_edge("process_events", "resolve_branching_instruction")

    # Fan-out: resolve_branching_instruction → [generate_response, detect_behaviors]
    graph.add_edge("resolve_branching_instruction", "generate_response")
    graph.add_edge("resolve_branching_instruction", "detect_behaviors")

    # Fan-in: [generate_response, detect_behaviors] → clear_events_and_detected_data
    graph.add_edge("generate_response", "clear_events_and_detected_data")
    graph.add_edge("detect_behaviors", "clear_events_and_detected_data")

    # Clear events data and lead to END
    graph.add_edge("clear_events_and_detected_data", END)

    return graph
