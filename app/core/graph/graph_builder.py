from langgraph.constants import START, END
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.nodes import process_events, generate_response
from app.core.graph.state import SimulationState


def build_graph() -> StateGraph[SimulationState]:
    """
    Build the LangGraph state graph.
    
    Flow:
    1. process_events: Detects events, updates EventRegistry
    2. generate_response: Generates LLM response based on detected events
    """
    graph = StateGraph(SimulationState)
    graph.add_node("process_events", process_events)
    graph.add_node("generate_response", generate_response)

    graph.add_edge(START, "process_events")
    graph.add_edge("process_events", "generate_response")
    graph.add_edge("generate_response", END)
    return graph
