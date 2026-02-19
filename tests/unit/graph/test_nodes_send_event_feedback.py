"""
Test cases for the send_event_feedback node.

This node is responsible for:
1. Merging feedback from branching and non-branching events (Priority 1 vs 2)
2. Calculating cumulative scores from all active events
3. Sending feedback to the UI
4. Clearing transient event/feedback state
"""

from unittest.mock import MagicMock, patch

import pytest
from langchain_core.messages import HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.graph.nodes import send_event_feedback
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class TestSendEventFeedback:
    @pytest.mark.asyncio
    async def test_sends_feedback_with_branching_priority(self):
        """Test that branching feedback takes priority over non-branching."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=BranchingInstruction.create("Branch"),
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=10,
                    event_id="e2",
                )
            ],
            feedback_to_send=EventFeedback(emoji="👍", message="Branch feedback"),
        )

        mock_room = MagicMock()
        mock_room.name = "test_room"

        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            result = await send_event_feedback(state, config=config)

            assert mock_send.called
            call_args = mock_send.call_args[0][0]
            assert call_args.data.message == "Branch feedback"
            assert call_args.data.score == 15  # 5 + 10

        assert result["branching_and_feedback_data"] == []
        assert result["non_branching_feedback_data"] == []
        assert result["feedback_to_send"] is None
        assert result["behavior_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_falls_back_to_non_branching_feedback(self, monkeypatch):
        """Test fallback to non-branching feedback when no branching feedback."""
        monkeypatch.setattr(
            "app.core.graph.nodes.settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS", True
        )

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="🎉", message="Another feedback"),
                    score=3,
                    event_id="e2",
                ),
            ],
            feedback_to_send=None,
        )

        mock_room = MagicMock()
        mock_room.name = "test_room"

        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            result = await send_event_feedback(state, config=config)

            assert mock_send.called
            call_args = mock_send.call_args[0][0]
            # Should use highest score non-branching feedback
            assert call_args.data.message == "Non-branch feedback"
            assert call_args.data.score == 8  # 5 + 3

        assert result["branching_and_feedback_data"] == []
        assert result["non_branching_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_calculates_cumulative_score_from_all_active_events(self):
        """Test that cumulative score includes all active events."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=BranchingInstruction.create("Branch"),
                    feedback=EventFeedback(emoji="👍", message="Branch feedback"),
                    score=10,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Another branch"),
                    score=-5,
                    event_id="e2",
                ),
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="🎉", message="Non-branch"),
                    score=3,
                    event_id="e3",
                )
            ],
            feedback_to_send=EventFeedback(emoji="👍", message="Branch feedback"),
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            call_args = mock_send.call_args[0][0]
            # Cumulative: 10 + (-5) + 3 = 8
            assert call_args.data.score == 8

    @pytest.mark.asyncio
    async def test_handles_empty_feedback_message(self):
        """Test that empty string is used when feedback message is None."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(
                        emoji=None, message=None, show_feedback=True
                    ),
                    score=10,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[],
            feedback_to_send=EventFeedback(
                emoji=None, message=None, show_feedback=True
            ),
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            call_args = mock_send.call_args[0][0]
            assert call_args.data.message == ""
            assert call_args.data.emoji is None
            assert call_args.data.show_feedback is True

    @pytest.mark.asyncio
    async def test_handles_no_feedback_to_send(self):
        """Test when no feedback is selected but events exist."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="👍", message="Feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[],
            feedback_to_send=None,
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            call_args = mock_send.call_args[0][0]
            # Should send with empty message but still send score
            assert call_args.data.message == ""
            assert call_args.data.emoji is None
            assert call_args.data.show_feedback is True
            assert call_args.data.score == 5

    @pytest.mark.asyncio
    async def test_no_ui_send_when_no_active_events(self):
        """Test that no UI message is sent when there are no active events."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
            feedback_to_send=None,
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            result = await send_event_feedback(state, config=config)

            # Should not send anything to UI
            assert not mock_send.called

        # Should still clear state
        assert result["branching_and_feedback_data"] == []
        assert result["non_branching_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_no_ui_send_when_no_room(self):
        """Test that no UI message is sent when room is not available."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="👍", message="Feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[],
            feedback_to_send=EventFeedback(emoji="👍", message="Feedback"),
        )

        config = {"configurable": {"room": None}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            result = await send_event_feedback(state, config=config)

            # Should not send anything to UI
            assert not mock_send.called

        # Should still clear state
        assert result["branching_and_feedback_data"] == []

    @pytest.mark.asyncio
    async def test_includes_detected_event_ids(self):
        """Test that detected event IDs are included in UI message."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="👍", message="Feedback 1"),
                    score=5,
                    event_id="event_1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Feedback 2"),
                    score=3,
                    event_id="event_2",
                )
            ],
            feedback_to_send=EventFeedback(emoji="👍", message="Feedback 1"),
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            call_args = mock_send.call_args[0][0]
            assert set(call_args.data.detected_event_ids) == {"event_1", "event_2"}

    @pytest.mark.asyncio
    async def test_only_includes_events_with_feedback(self):
        """Test that only events with feedback are included in score calculation."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="👍", message="Has feedback"),
                    score=10,
                    event_id="e1",
                ),
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=None,  # No feedback
                    score=100,  # Should not be included
                    event_id="e2",
                ),
            ],
            non_branching_feedback_data=[],
            feedback_to_send=EventFeedback(emoji="👍", message="Has feedback"),
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            call_args = mock_send.call_args[0][0]
            # Should only include e1's score (10), not e2's (100)
            assert call_args.data.score == 10
            assert call_args.data.detected_event_ids == ["e1"]

    @pytest.mark.asyncio
    async def test_non_branching_fallback_disabled_in_sequential_mode(
        self, monkeypatch
    ):
        """Test that non-branching fallback is disabled when
        optimization flag is off."""
        monkeypatch.setattr(
            "app.core.graph.nodes.settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS", False
        )

        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Non-branch feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            feedback_to_send=None,
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui") as mock_send:
            await send_event_feedback(state, config=config)

            # Should still send UI message with cumulative score
            # but feedback_message should be empty (no fallback)
            call_args = mock_send.call_args[0][0]
            assert call_args.data.message == ""
            assert call_args.data.score == 5

    @pytest.mark.asyncio
    async def test_clears_all_transient_state(self):
        """Test that all transient state fields are cleared."""
        state = SimulationState(
            messages=[HumanMessage(content="Hello")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=0,
            branching_and_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="👍", message="Feedback"),
                    score=5,
                    event_id="e1",
                )
            ],
            non_branching_feedback_data=[
                BranchingAndFeedbackData(
                    branching_instruction=None,
                    feedback=EventFeedback(emoji="😊", message="Feedback 2"),
                    score=3,
                    event_id="e2",
                )
            ],
            feedback_to_send=EventFeedback(emoji="👍", message="Feedback"),
            behavior_feedback_data=[],
        )

        mock_room = MagicMock()
        config = {"configurable": {"room": mock_room}}

        with patch("app.core.graph.nodes.send_event_to_ui"):
            result = await send_event_feedback(state, config=config)

        # All transient fields should be cleared
        assert result["branching_and_feedback_data"] == []
        assert result["non_branching_feedback_data"] == []
        assert result["feedback_to_send"] is None
        assert result["behavior_feedback_data"] == []
