from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.graph_builder import build_graph
from app.core.graph.state import SimulationState

_checkpointer = MemorySaver()
agent_graph: CompiledStateGraph[SimulationState] = build_graph().compile(checkpointer=_checkpointer)
