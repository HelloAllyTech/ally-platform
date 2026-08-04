from langgraph.checkpoint.memory import MemorySaver
from langgraph.graph import StateGraph

from app.core.graph import agent_graph
from app.core.graph.graph_builder import build_simulation_graph


class TestGraphBuilder:
    def test_build_graph_returns_state_graph(self):
        graph = build_simulation_graph()
        assert isinstance(graph, StateGraph)

    def test_compile_graph_produces_compiled_graph(self):
        # Ensure the exported compiled graph exists and is callable with checkpointer
        assert agent_graph is not None
        # Build/compile locally as well
        compiled = build_simulation_graph().compile(checkpointer=MemorySaver())
        # compiled is a CompiledStateGraph; we just check it has an invoke method
        assert hasattr(compiled, "ainvoke") or hasattr(compiled, "invoke")
