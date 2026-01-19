from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.config import settings
from app.core.graph.nodes import generate_response, process_events
from app.core.graph.state import SimulationState


def build_voice_expressions_subgraph() -> CompiledStateGraph[SimulationState]:
    """
    Build a subgraph for applying voice expressions.

    This subgraph is isolated from the main graph's streaming output.
    When subgraphs=False (default in LLMAdapter), the LLM outputs from
    this subgraph will NOT be streamed to TTS/UI, preventing the parameters
    dict from appearing in the agent's response.

    Returns:
        Compiled subgraph that applies voice expressions
    """
    # Import here to avoid import error when feature is disabled
    from app.core.graph.nodes import apply_voice_expressions

    subgraph = StateGraph(SimulationState)
    subgraph.add_node("apply_voice_expressions", apply_voice_expressions)
    subgraph.add_edge(START, "apply_voice_expressions")
    subgraph.add_edge("apply_voice_expressions", END)
    return subgraph.compile()


def build_graph() -> StateGraph[SimulationState]:
    """
    Build the LangGraph state graph.

    Flow:
    1. process_events: Detects events, updates EventRegistry
    2. generate_response: Generates LLM response based on detected events
    3. apply_voice_expressions: Applies voice expression tool calls from LLM
       (as subgraph) [if enabled]

    Note: apply_voice_expressions is a subgraph to prevent its LLM outputs
    from being streamed. With subgraphs=False (default), only root graph
    outputs are streamed, preventing the parameters dict from appearing.
    """
    # Build the main graph
    graph = StateGraph(SimulationState)
    graph.add_node("process_events", process_events)
    graph.add_node("generate_response", generate_response)

    graph.add_edge(START, "process_events")
    graph.add_edge("process_events", "generate_response")

    if settings.ENABLE_VOICE_EXPRESSIONS:
        # Build the voice expressions subgraph
        voice_expressions_subgraph = build_voice_expressions_subgraph()
        # Add the subgraph as a node - this prevents its LLM outputs from being streamed
        graph.add_node("apply_voice_expressions", voice_expressions_subgraph)
        graph.add_edge("generate_response", "apply_voice_expressions")
        graph.add_edge("apply_voice_expressions", END)
    else:
        graph.add_edge("generate_response", END)

    return graph
