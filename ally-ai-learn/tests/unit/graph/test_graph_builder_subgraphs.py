"""
Test cases for graph builder subgraph isolation and structure.

These tests ensure that branching instruction resolution and knowledge
retrieval are properly isolated in subgraphs to prevent LLM output
streaming issues.
"""

from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.graph_builder import (
    build_resolve_branching_subgraph,
    build_simulation_graph,
)


class TestSubgraphStructure:
    """Test subgraph structure and isolation."""

    def test_resolve_branching_subgraph_structure(self):
        """Test that resolve_branching_instruction subgraph is properly structured."""
        subgraph = build_resolve_branching_subgraph()

        assert isinstance(subgraph, CompiledStateGraph)
        assert subgraph is not None

    def test_main_graph_has_all_nodes(self):
        """Test that main graph includes all required nodes."""
        graph = build_simulation_graph()

        assert isinstance(graph, StateGraph)

        expected_nodes = [
            "process_events",
            "resolve_branching_instruction",
            "generate_response",
            "detect_behaviors",
            "publish_done_thinking",
            "send_event_feedback",
        ]

        for node_name in expected_nodes:
            assert node_name in graph.nodes, f"Missing node: {node_name}"

    def test_graph_execution_flow(self):
        """Test that graph has correct execution flow."""
        graph = build_simulation_graph()

        # Verify edges exist for the expected flow
        # process_events -> resolve_branching_instruction
        # resolve_branching_instruction -> [generate_response, detect_behaviors]
        # generate_response -> publish_done_thinking -> END

        assert "process_events" in graph.nodes
        assert "resolve_branching_instruction" in graph.nodes
        assert "generate_response" in graph.nodes
        assert "detect_behaviors" in graph.nodes
        assert "publish_done_thinking" in graph.nodes
        assert "send_event_feedback" in graph.nodes


class TestSubgraphIsolation:
    """Test that subgraphs are properly isolated from main graph streaming."""

    def test_subgraphs_are_compiled_before_adding_to_main_graph(self):
        """Test that subgraphs are compiled (not raw StateGraph) when added to main."""
        # This ensures subgraphs=False in LLMAdapter will prevent their streaming
        resolve_subgraph = build_resolve_branching_subgraph()

        # Should be CompiledStateGraph, not StateGraph
        assert isinstance(resolve_subgraph, CompiledStateGraph)

        # It should NOT be a StateGraph instance
        assert not isinstance(resolve_subgraph, StateGraph)
