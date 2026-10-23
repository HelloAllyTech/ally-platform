"""
Unit tests for process_events helper functions.

These tests ensure the extracted helper functions work correctly independently.
"""

from unittest.mock import Mock, patch

from langchain_core.messages import HumanMessage

from app.core.branching_instructions.base import BranchingInstruction
from app.core.config import settings
from app.core.events.base import BaseEvent
from app.core.graph.nodes import (
    _build_state_update_dict,
    _calculate_score_updates,
    _log_event_data,
    _split_events_by_type,
)
from app.core.graph.state import (
    BranchingAndFeedbackData,
    EventFeedback,
    SimulationState,
)


class TestSplitEventsByType:
    """Test event splitting logic."""

    def test_split_events_parallel_mode_branching_and_non_branching(self):
        """Test splitting events in parallel mode."""
        with patch.object(settings, "ENABLE_EVENT_DETECTION_OPTIMIZATIONS", True):
            branching_data = BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("test"),
                feedback=EventFeedback(emoji=":)", message="Test", show_feedback=True),
                score=5,
                event_id="test_event_1",
            )
            non_branching_data = BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(
                    emoji=":D", message="Non-branch", show_feedback=True
                ),
                score=10,
                event_id="test_event_2",
            )

            all_data = [branching_data, non_branching_data]
            branching, non_branching = _split_events_by_type(all_data)

            assert len(branching) == 1
            assert len(non_branching) == 1
            assert branching[0].branching_instruction is not None
            assert non_branching[0].branching_instruction is None

    def test_split_events_sequential_mode_all_in_branching(self):
        """Test sequential mode puts all events in branching."""
        with patch.object(settings, "ENABLE_EVENT_DETECTION_OPTIMIZATIONS", False):
            branching_data = BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("test"),
                feedback=EventFeedback(emoji=":)", message="Test", show_feedback=True),
                score=5,
                event_id="test_event_1",
            )
            non_branching_data = BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(
                    emoji=":D", message="Non-branch", show_feedback=True
                ),
                score=10,
                event_id="test_event_2",
            )

            all_data = [branching_data, non_branching_data]
            branching, non_branching = _split_events_by_type(all_data)

            assert len(branching) == 2  # All events go to branching
            assert len(non_branching) == 0  # Empty in sequential mode

    def test_split_events_empty_list(self):
        """Test splitting empty list."""
        branching, non_branching = _split_events_by_type([])
        assert len(branching) == 0
        assert len(non_branching) == 0


class TestCalculateScoreUpdates:
    """Test score calculation logic."""

    def test_calculate_score_with_new_events_and_additional_score(self):
        """Test score calculation with both new events and additional score."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        # Mock events with scores
        event1 = Mock(spec=BaseEvent)
        event1.score = 5
        event2 = Mock(spec=BaseEvent)
        event2.score = 3
        new_events = [event1, event2]

        additional_score = 7
        new_score = _calculate_score_updates(state, new_events, additional_score)

        # 10 (current) + 5 + 3 (new events) + 7 (additional) = 25
        assert new_score == 25

    def test_calculate_score_no_changes(self):
        """Test score calculation with no changes."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        new_score = _calculate_score_updates(state, [], 0)
        assert new_score == 10

    def test_calculate_score_events_with_none_score(self):
        """Test score calculation with events that have None score."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        event1 = Mock(spec=BaseEvent)
        event1.score = None
        event2 = Mock(spec=BaseEvent)
        event2.score = 5

        new_score = _calculate_score_updates(state, [event1, event2], 0)
        # Only event2's score (5) should be counted
        assert new_score == 15


class TestBuildStateUpdateDict:
    """Test state update dictionary building."""

    def test_build_state_update_dict_with_branching_events(self):
        """Test building state update dict with branching events."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        detected_events = [("2024-01-01T00:00:00Z", Mock())]
        new_events = [Mock()]
        branching_data = [
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("test"),
                feedback=EventFeedback(emoji=":)", message="Test", show_feedback=True),
                score=5,
                event_id="test_event_1",
            )
        ]

        with patch.object(settings, "ENABLE_EVENT_DETECTION_OPTIMIZATIONS", True):
            update_dict = _build_state_update_dict(
                state, detected_events, new_events, 15, branching_data, []
            )

            assert update_dict["current_score"] == 15
            assert "branching_and_feedback_data" in update_dict
            assert len(update_dict["branching_and_feedback_data"]) == 1
            assert update_dict["non_branching_feedback_data"] is None

    def test_build_state_update_dict_with_non_branching_events(self):
        """Test building state update dict with non-branching events."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        detected_events = []
        new_events = []
        non_branching_data = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(
                    emoji=":D", message="Non-branch", show_feedback=True
                ),
                score=10,
                event_id="test_event_2",
            )
        ]

        update_dict = _build_state_update_dict(
            state, detected_events, new_events, 20, [], non_branching_data
        )

        assert "non_branching_feedback_data" in update_dict
        assert len(update_dict["non_branching_feedback_data"]) == 1
        assert update_dict["branching_and_feedback_data"] is None

    def test_build_state_update_dict_empty_events(self):
        """Test building state update dict with no events."""
        state = SimulationState(
            messages=[HumanMessage(content="test")],
            permitted_events=[],
            events_accumulator=[],
            new_events=[],
            current_score=10,
            branching_and_feedback_data=[],
            non_branching_feedback_data=[],
        )

        update_dict = _build_state_update_dict(state, [], [], 10, [], [])

        assert update_dict["current_score"] == 10
        assert update_dict["branching_and_feedback_data"] is None
        assert update_dict["non_branching_feedback_data"] is None


class TestLogEventData:
    """Test event data logging."""

    @patch("app.core.graph.nodes.logger")
    def test_log_event_data_with_branching_and_non_branching(self, mock_logger):
        """Test logging event data with both types."""
        branching_data = BranchingAndFeedbackData(
            branching_instruction=BranchingInstruction.create("test"),
            feedback=EventFeedback(emoji=":)", message="Test", show_feedback=True),
            score=5,
            event_id="test_event_1",
        )
        non_branching_data = BranchingAndFeedbackData(
            branching_instruction=None,
            feedback=EventFeedback(
                emoji=":D", message="Non-branch", show_feedback=True
            ),
            score=10,
            event_id="test_event_2",
        )

        _log_event_data([branching_data, non_branching_data])

        # Verify logger.info was called
        assert mock_logger.info.called
        # Check that both event types are logged
        call_args = str(mock_logger.info.call_args_list)
        assert "BRANCHING" in call_args
        assert "NON-BRANCHING" in call_args

    @patch("app.core.graph.nodes.logger")
    def test_log_event_data_empty_list(self, mock_logger):
        """Test logging empty event data list."""
        _log_event_data([])
        # Should not log anything for empty list
        assert not mock_logger.info.called
