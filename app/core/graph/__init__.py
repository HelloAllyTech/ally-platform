from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.graph_builder import build_graph
from app.core.graph.state import SimulationState
from app.core.logger import get_logger

logger = get_logger(__name__)

_checkpointer = MemorySaver()

try:
    agent_graph: CompiledStateGraph[SimulationState] = build_graph().compile(
        checkpointer=_checkpointer
    )
except Exception as e:
    logger.error(
        f"Failed to build or compile agent graph: {e}",
        exc_info=True,
    )
    raise
