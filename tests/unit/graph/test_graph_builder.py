from langgraph.checkpoint.memory import MemorySaver
from langgraph.constants import START
from langgraph.graph import StateGraph

from app.core.graph import agent_graph
from app.core.graph.graph_builder import _build_report_graph, build_simulation_graph


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


def _edge_pairs(graph: StateGraph):
    """StateGraph.edges is a set of (source, target) string tuples."""
    return {(src, dst) for src, dst in graph.edges}


class TestCompressInputWiring:
    """compress_input must run in parallel from START and feed
    generate_response directly (a second predecessor, alongside
    resolve_branching_instruction) rather than joining the sync barrier —
    see compress_input's docstring in app/core/graph/nodes.py for why."""

    def test_simulation_graph_wires_compress_input_to_generate_response(self):
        graph = build_simulation_graph()
        assert "compress_input" in graph.nodes
        edges = _edge_pairs(graph)
        assert (START, "compress_input") in edges
        assert ("compress_input", "generate_response") in edges
        # Must NOT join the sync barrier — it has exactly one consumer.
        assert ("compress_input", "sync_events_and_behaviors_node") not in edges

    def test_report_graph_wires_compress_input_to_generate_response(self):
        graph = _build_report_graph()
        assert "compress_input" in graph.nodes
        edges = _edge_pairs(graph)
        assert (START, "compress_input") in edges
        assert ("compress_input", "generate_response") in edges
        assert ("compress_input", "sync_events_and_behaviors_node") not in edges
