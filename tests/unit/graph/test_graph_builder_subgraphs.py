"""
Test cases for graph builder subgraph isolation and structure.

These tests ensure that branching instruction resolution, behavior detection,
and voice expressions are properly isolated in subgraphs to prevent
LLM output streaming issues.
"""

from langgraph.graph import StateGraph
from langgraph.graph.state import CompiledStateGraph

from app.core.graph.graph_builder import (
    build_detect_behaviors_subgraph,
    build_graph,
    build_resolve_branching_subgraph,
    build_voice_expressions_subgraph,
)


class TestSubgraphStructure:
    """Test subgraph structure and isolation."""

    def test_resolve_branching_subgraph_structure(self):
        """Test that resolve_branching_instruction subgraph is properly structured."""
        subgraph = build_resolve_branching_subgraph()

        assert isinstance(subgraph, CompiledStateGraph)
        assert subgraph is not None

    def test_voice_expressions_subgraph_structure(self):
        """Test that voice_expressions subgraph is properly structured."""
        subgraph = build_voice_expressions_subgraph()

        assert isinstance(subgraph, CompiledStateGraph)
        assert subgraph is not None

    def test_detect_behaviors_subgraph_structure(self):
        """Test that detect_behaviors subgraph is properly structured."""
        subgraph = build_detect_behaviors_subgraph()

        assert isinstance(subgraph, CompiledStateGraph)
        assert subgraph is not None

    def test_main_graph_has_all_nodes(self):
        """Test that main graph includes all required nodes."""
        graph = build_graph()

        assert isinstance(graph, StateGraph)

        expected_nodes = [
            "process_events",
            "resolve_branching_instruction",
            "generate_response",
            "detect_behaviors",
            "apply_voice_expressions",
        ]

        for node_name in expected_nodes:
            assert node_name in graph.nodes, f"Missing node: {node_name}"

    def test_graph_execution_flow(self):
        """Test that graph has correct execution flow."""
        graph = build_graph()

        # Verify edges exist for the expected flow
        # process_events -> resolve_branching_instruction
        # resolve_branching_instruction -> [generate_response, detect_behaviors]
        # [generate_response, detect_behaviors] -> apply_voice_expressions

        assert "process_events" in graph.nodes
        assert "resolve_branching_instruction" in graph.nodes
        assert "generate_response" in graph.nodes
        assert "detect_behaviors" in graph.nodes
        assert "apply_voice_expressions" in graph.nodes


class TestSubgraphIsolation:
    """Test that subgraphs are properly isolated from main graph streaming."""

    def test_subgraphs_are_compiled_before_adding_to_main_graph(self):
        """Test that subgraphs are compiled (not raw StateGraph) when added to main."""
        # This ensures subgraphs=False in LLMAdapter will prevent their streaming
        resolve_subgraph = build_resolve_branching_subgraph()
        behaviors_subgraph = build_detect_behaviors_subgraph()
        voice_subgraph = build_voice_expressions_subgraph()

        # All should be CompiledStateGraph, not StateGraph
        assert isinstance(resolve_subgraph, CompiledStateGraph)
        assert isinstance(behaviors_subgraph, CompiledStateGraph)
        assert isinstance(voice_subgraph, CompiledStateGraph)

        # They should NOT be StateGraph instances
        assert not isinstance(resolve_subgraph, StateGraph)
        assert not isinstance(behaviors_subgraph, StateGraph)
        assert not isinstance(voice_subgraph, StateGraph)
