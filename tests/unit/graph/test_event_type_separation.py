"""
Test event splitting logic for branching vs non-branching events.

These tests ensure the _split_events_by_type function correctly separates
events based on whether they have branching instructions, which is critical
for the parallel processing optimization.
"""

from app.core.branching_instructions.base import BranchingInstruction
from app.core.graph.nodes import _split_events_by_type
from app.core.graph.state import BranchingAndFeedbackData, EventFeedback


class TestEventSplittingLogic:
    """Test event splitting logic for parallel processing."""

    def test_split_all_branching_events(self):
        """Test splitting when all events have branching instructions."""
        all_events = [
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Instruction 1"),
                feedback=EventFeedback(emoji="👍", message="Feedback 1"),
                score=10,
                event_id="event1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Instruction 2"),
                feedback=EventFeedback(emoji="😊", message="Feedback 2"),
                score=5,
                event_id="event2",
            ),
        ]

        branching, non_branching = _split_events_by_type(all_events)

        assert len(branching) == 2
        assert len(non_branching) == 0

    def test_split_all_non_branching_events(self):
        """Test splitting when all events are non-branching."""
        all_events = [
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(emoji="👍", message="Feedback 1"),
                score=10,
                event_id="event1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(emoji="😊", message="Feedback 2"),
                score=5,
                event_id="event2",
            ),
        ]

        branching, non_branching = _split_events_by_type(all_events)

        assert len(branching) == 0
        assert len(non_branching) == 2

    def test_split_mixed_events(self):
        """Test splitting with mix of branching and non-branching events."""
        all_events = [
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Instruction 1"),
                feedback=EventFeedback(emoji="👍", message="Branching 1"),
                score=10,
                event_id="event1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(emoji="😊", message="Non-branching 1"),
                score=5,
                event_id="event2",
            ),
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Instruction 2"),
                feedback=EventFeedback(emoji="🎉", message="Branching 2"),
                score=15,
                event_id="event3",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(emoji="👎", message="Non-branching 2"),
                score=-5,
                event_id="event4",
            ),
        ]

        branching, non_branching = _split_events_by_type(all_events)

        assert len(branching) == 2
        assert len(non_branching) == 2

        # Verify correct separation
        assert all(e.branching_instruction is not None for e in branching)
        assert all(e.branching_instruction is None for e in non_branching)

    def test_split_empty_list(self):
        """Test splitting with empty event list."""
        all_events = []

        branching, non_branching = _split_events_by_type(all_events)

        assert len(branching) == 0
        assert len(non_branching) == 0

    def test_split_preserves_event_data(self):
        """Test that splitting preserves all event data correctly."""
        original_event = BranchingAndFeedbackData(
            branching_instruction=BranchingInstruction.create("Test instruction"),
            feedback=EventFeedback(emoji="👍", message="Test feedback"),
            score=42,
            event_id="test_event_123",
        )

        branching, non_branching = _split_events_by_type([original_event])

        assert len(branching) == 1
        split_event = branching[0]

        # Verify all fields are preserved
        assert split_event.branching_instruction.content == "Test instruction"
        assert split_event.feedback.emoji == "👍"
        assert split_event.feedback.message == "Test feedback"
        assert split_event.score == 42
        assert split_event.event_id == "test_event_123"

    def test_split_with_events_without_feedback(self):
        """Test splitting events that have no feedback."""
        all_events = [
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Instruction"),
                feedback=None,  # No feedback
                score=10,
                event_id="event1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=None,  # No feedback
                score=5,
                event_id="event2",
            ),
        ]

        branching, non_branching = _split_events_by_type(all_events)

        assert len(branching) == 1
        assert len(non_branching) == 1
        assert branching[0].feedback is None
        assert non_branching[0].feedback is None

    def test_split_maintains_order(self):
        """Test that splitting maintains the original order of events."""
        all_events = [
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("First"),
                feedback=EventFeedback(emoji="1️⃣", message="First"),
                score=1,
                event_id="event1",
            ),
            BranchingAndFeedbackData(
                branching_instruction=None,
                feedback=EventFeedback(emoji="2️⃣", message="Second"),
                score=2,
                event_id="event2",
            ),
            BranchingAndFeedbackData(
                branching_instruction=BranchingInstruction.create("Third"),
                feedback=EventFeedback(emoji="3️⃣", message="Third"),
                score=3,
                event_id="event3",
            ),
        ]

        branching, non_branching = _split_events_by_type(all_events)

        # Branching events should maintain order
        assert branching[0].feedback.message == "First"
        assert branching[1].feedback.message == "Third"

        # Non-branching events should maintain order
        assert non_branching[0].feedback.message == "Second"
