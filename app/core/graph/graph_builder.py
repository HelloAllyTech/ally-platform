from langgraph.constants import END, START
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.config import settings
from app.core.graph.nodes import (
    generate_response,
    process_events,
    resolve_branching_instruction,
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
    # Import here to avoid import error when feature is disabled
    try:
        from app.core.graph.nodes import apply_voice_expressions
    except ImportError as e:
        from app.utils.logger import get_logger

        logger = get_logger(__name__)
        logger.error(
            f"Failed to import apply_voice_expressions: {e}. "
            f"Check for circular dependencies or missing modules.",
            exc_info=True,
        )
        raise

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
    2. resolve_branching_instruction: Resolves branching instructions with LLM calls
       (as subgraph)
    3. generate_response: Generates LLM response based on detected events
    4. apply_voice_expressions: Applies voice expression tool calls from LLM
       (as subgraph) [if enabled]

    Note: resolve_branching_instruction and apply_voice_expressions are subgraphs to
    prevent their LLM outputs from being streamed. With subgraphs=False
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

    graph.add_edge(START, "process_events")
    graph.add_edge("process_events", "resolve_branching_instruction")
    graph.add_edge("resolve_branching_instruction", "generate_response")

    if settings.ENABLE_VOICE_EXPRESSIONS:
        # Build the apply_voice_expressions subgraph and add it as a node
        # This prevents its LLM outputs (for voice expression parameters) from being
        # streamed
        voice_expressions_subgraph = build_voice_expressions_subgraph()
        graph.add_node("apply_voice_expressions", voice_expressions_subgraph)
        graph.add_edge("generate_response", "apply_voice_expressions")
        graph.add_edge("apply_voice_expressions", END)
    else:
        graph.add_edge("generate_response", END)

    return graph
