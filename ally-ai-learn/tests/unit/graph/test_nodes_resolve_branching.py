"""
Test cases for resolve_branching_instruction node.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from langchain_core.messages import HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.graph.nodes import resolve_branching_instruction
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


@pytest.fixture
def mock_scenario():
    """Create a mock scenario with language config."""
    scenario = MagicMock()
    scenario.language_config.language_code = "en-US"
    scenario.language_config.branching_llm_config = {"model": "gpt-4"}
    return scenario


@pytest.fixture
def base_state():
    """Create a base simulation state."""
    return SimulationState(
        messages=[HumanMessage(content="Hello")],
        permitted_events=[],
        events_accumulator=[],
        new_events=[],
        current_score=0,
        branching_and_feedback_data=[],
        non_branching_feedback_data=[],
    )


class TestResolveBranchingInstruction:
    """Test resolve_branching_instruction node."""

    @pytest.mark.asyncio
    async def test_resolve_llm_response_tags(self, base_state, mock_scenario):
        """Test resolving llm_response tags in branching instruction."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        base_state.branching_and_feedback_data = [
            BranchingAndFeedbackData(
                branching_instruction=instruction,
                feedback=EventFeedback(emoji="💪", message="Exercise time"),
                score=10,
                event_id="test_event_id",
            ),
        ]

        config = {"configurable": {"scenario": mock_scenario}}

        # Mock the resolve_llm_responses method
        async def mock_resolve(llm_config, language_code):
            instruction.content = "Use Exercise improves health"
            instruction._llm_resolved = True

        instruction.resolve_llm_responses = mock_resolve

        result = await resolve_branching_instruction(base_state, config)

        assert result["next_instruction"] == "Use Exercise improves health"

    @pytest.mark.asyncio
    async def test_skip_llm_resolution_if_already_resolved(self, base_state):
        """Test that LLM resolution is skipped if already resolved."""
        instruction = BranchingInstruction.create("Regular instruction")
        instruction._llm_resolved = True  # Mark as already resolved

        base_state.branching_and_feedback_data = [
            BranchingAndFeedbackData(
                branching_instruction=instruction,
                feedback=EventFeedback(emoji="👍", message="Good"),
                score=10,
                event_id="test_event_id",
            ),
        ]

        # Mock to ensure it's not called
        resolve_mock = AsyncMock()
        instruction.resolve_llm_responses = resolve_mock

        result = await resolve_branching_instruction(base_state)

        # Should not call resolve since already resolved
        resolve_mock.assert_not_called()
        assert result["next_instruction"] == "Regular instruction"
