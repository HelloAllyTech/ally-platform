from langgraph.constants import START, END
from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.nodes import process_events, send_events_to_ui, send_events_to_core, generate_response
from app.core.graph.state import SimulationState


def build_graph() -> StateGraph[SimulationState]:
    graph = StateGraph(SimulationState)
    graph.add_node("process_events", process_events)
    graph.add_node("send_events_to_ui", send_events_to_ui)
    graph.add_node("generate_response", generate_response)
    graph.add_node("send_events_to_core", send_events_to_core)

    graph.add_edge(START, "process_events")
    graph.add_edge("process_events", "send_events_to_ui")
    graph.add_edge("process_events", "generate_response")
    graph.add_edge("process_events", "send_events_to_core")
    graph.add_edge("send_events_to_ui", END)
    graph.add_edge("generate_response", END)
    graph.add_edge("send_events_to_core", END)
    return graph
