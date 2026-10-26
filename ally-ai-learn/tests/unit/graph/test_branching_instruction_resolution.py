"""
Test edge cases for resolve_branching_instruction node.

These tests cover critical business logic scenarios that could cause failures:
- Empty branching_and_feedback_data
- Multiple branching events with different scores
- LLM resolution failures
- Missing scenario configuration
- Dynamic variable resolution edge cases
"""

from unittest.mock import MagicMock

import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.graph.nodes import resolve_branching_instruction
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class TestResolveBranchingEdgeCases:
    """Test edge cases in branching instruction resolution."""

    @pytest.mark.asyncio
    async def test_empty_branching_and_feedback_data(self):
        """Test handling when no branching events exist."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],  # Empty
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        assert result["next_instruction"] is None
        assert result["feedback_to_send"] is None

    @pytest.mark.asyncio
    async def test_multiple_branching_events_selects_highest_score(self):
        """Test that highest score branching event is selected."""
        instruction1 = BranchingInstruction.create("Low priority instruction")
        instruction1._llm_resolved = True

        instruction2 = BranchingInstruction.create("High priority instruction")
        instruction2._llm_resolved = True

        instruction3 = BranchingInstruction.create("Medium priority instruction")
        instruction3._llm_resolved = True

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction1,
                    feedback=EventFeedback(emoji="👍", message="Low"),
                    score=5,
                    event_id="event1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=instruction2,
                    feedback=EventFeedback(emoji="🎉", message="High"),
                    score=15,  # Highest
                    event_id="event2",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=instruction3,
                    feedback=EventFeedback(emoji="😊", message="Medium"),
                    score=10,
                    event_id="event3",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        assert result["next_instruction"] == "High priority instruction"
        assert result["feedback_to_send"].message == "High"

    @pytest.mark.asyncio
    async def test_negative_scores_use_absolute_value(self):
        """Test that negative scores are compared by absolute value."""
        instruction1 = BranchingInstruction.create("Positive score instruction")
        instruction1._llm_resolved = True

        instruction2 = BranchingInstruction.create("Negative score instruction")
        instruction2._llm_resolved = True

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction1,
                    feedback=EventFeedback(emoji="👍", message="Positive"),
                    score=10,
                    event_id="event1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=instruction2,
                    feedback=EventFeedback(emoji="👎", message="Negative"),
                    score=-20,  # Higher absolute value
                    event_id="event2",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        # Should select the one with higher absolute value (-20)
        assert result["next_instruction"] == "Negative score instruction"
        assert result["feedback_to_send"].message == "Negative"

    @pytest.mark.asyncio
    async def test_llm_resolution_failure_handling(self):
        """Test graceful handling when LLM resolution fails."""
        instruction = BranchingInstruction.create(
            "Use <llm_response(facts about exercise)>"
        )

        # Mock resolve_llm_responses to raise an exception
        async def mock_resolve_with_error(llm_config, language_code, **kwargs):
            raise Exception("LLM API failed")

        instruction.resolve_llm_responses = mock_resolve_with_error

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="💪", message="Exercise"),
                    score=10,
                    event_id="event1",
                ),
            ],
            non_branching_feedback_data=[],
        )

        scenario = MagicMock()
        scenario.language_config.language_code = "en-US"
        scenario.language_config.branching_llm_config = {"model": "gpt-4"}
        config = {"configurable": {"scenario": scenario}}

        # Should not crash, but propagate the exception
        with pytest.raises(Exception, match="LLM API failed"):
            await resolve_branching_instruction(state, config)

    @pytest.mark.asyncio
    async def test_missing_scenario_config_uses_defaults(self):
        """Test that missing scenario config uses default values."""
        instruction = BranchingInstruction.create("Simple instruction")
        instruction._llm_resolved = True

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="👍", message="Good"),
                    score=10,
                    event_id="event1",
                ),
            ],
            non_branching_feedback_data=[],
        )

        # No config provided
        result = await resolve_branching_instruction(state, config=None)

        assert result["next_instruction"] == "Simple instruction"
        assert result["feedback_to_send"].message == "Good"

    @pytest.mark.asyncio
    async def test_branching_event_without_feedback(self):
        """Test branching event that has instruction but no feedback."""
        instruction = BranchingInstruction.create("Instruction without feedback")
        instruction._llm_resolved = True

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=None,  # No feedback
                    score=10,
                    event_id="event1",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        assert result["next_instruction"] == "Instruction without feedback"
        assert result["feedback_to_send"] is None

    @pytest.mark.asyncio
    async def test_mixed_events_with_and_without_branching_instructions(self):
        """Test handling when some events have branching instructions and some don't."""
        instruction = BranchingInstruction.create("Valid instruction")
        instruction._llm_resolved = True

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,  # No instruction
                    feedback=EventFeedback(emoji="😊", message="No instruction"),
                    score=20,
                    event_id="event1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=instruction,  # Has instruction
                    feedback=EventFeedback(emoji="👍", message="Has instruction"),
                    score=10,
                    event_id="event2",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        # Should select the one with branching instruction, not the higher score
        assert result["next_instruction"] == "Valid instruction"
        assert result["feedback_to_send"].message == "Has instruction"

    @pytest.mark.asyncio
    async def test_dynamic_variable_resolution_with_empty_messages(self):
        """Test dynamic variable resolution when message history is empty."""
        instruction = BranchingInstruction.create("Respond to <last_helper_utterance>")
        instruction._llm_resolved = True

        state = SimulationState(
            messages=[],  # Empty message history
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="👍", message="Test"),
                    score=10,
                    event_id="event1",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        # Should keep the tag as-is when no messages exist
        assert "<last_helper_utterance>" in result["next_instruction"]

    @pytest.mark.asyncio
    async def test_dynamic_variable_resolution_with_only_ai_messages(self):
        """Test dynamic variable resolution when only AI messages exist."""
        instruction = BranchingInstruction.create("Respond to <last_helper_utterance>")
        instruction._llm_resolved = True

        state = SimulationState(
            messages=[
                AIMessage(content="AI message 1"),
                AIMessage(content="AI message 2"),
            ],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=instruction,
                    feedback=EventFeedback(emoji="👍", message="Test"),
                    score=10,
                    event_id="event1",
                ),
            ],
            non_branching_feedback_data=[],
        )

        result = await resolve_branching_instruction(state)

        # Should keep the tag as-is when no Human messages exist
        assert "<last_helper_utterance>" in result["next_instruction"]
