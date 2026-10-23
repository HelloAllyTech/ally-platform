from langgraph.graph.state import CompiledStateGraph

from app.core.graph.checkpointer import PruningCheckpointer
from app.core.graph.graph_builder import build_simulation_graph
from app.core.graph.state import SimulationState
from app.core.logger import get_logger

logger = get_logger(__name__)

_checkpointer = PruningCheckpointer()

try:
    agent_graph: CompiledStateGraph[SimulationState] = build_simulation_graph().compile(
        checkpointer=_checkpointer
    )
except Exception as e:
    logger.error(
        f"Failed to build or compile agent graph: {e}",
        exc_info=True,
    )
    raise


def cleanup_simulation_checkpoints(thread_id: str) -> None:
    """Remove all checkpoint data for a finished simulation session."""
    _checkpointer.delete_thread(thread_id)
