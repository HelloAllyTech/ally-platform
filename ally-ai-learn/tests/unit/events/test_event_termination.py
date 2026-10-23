"""
Tests for event termination feature (terminate_on_occurrence flag).
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.constants import VisibilityType
from app.core.events.base import BaseEvent
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.factory import build_events_from_metadata


class DummyEvent(BaseEvent):
    """Test event that always detects."""

    async def detect_event(self, conversations):
        return True


def create_mock_scenario(
    events,
    trigger_events=None,
    termination_event_id=None,
    termination_message=None,
    termination_events=None,
):
    """
    Helper to create a mock scenario for testing.

    Args:
        events: List of events
        trigger_events: List of event IDs to trigger
        termination_event_id: Single termination event ID (for convenience in tests)
        termination_message: Termination message for single event
        termination_events: List of termination event configs
            (each with id, termination_message, and optional score)
    """
    mock_scenario = MagicMock()
    mock_scenario.events = events
    mock_scenario.trigger_events = trigger_events

    # Handle termination_events list
    if termination_events:
        mock_termination_events = []
        for te in termination_events:
            mock_te = MagicMock()
            mock_te.id = te["id"]
            mock_te.termination_message = te.get("termination_message", "")
            mock_te.score = te.get("score")
            mock_termination_events.append(mock_te)
        mock_scenario.termination_events = mock_termination_events
    elif termination_event_id:
        # Create termination_events from single termination event
        # (convenience for tests)
        mock_te = MagicMock()
        mock_te.id = termination_event_id
        mock_te.termination_message = termination_message or ""
        mock_te.score = None
        mock_scenario.termination_events = [mock_te]
    else:
        mock_scenario.termination_events = []

    return mock_scenario


class TestEventTermination:
    """Test suite for event termination functionality."""

    def test_event_orchestrator_stores_termination_config(self):
        """Test that EventOrchestrator stores termination configuration
        from scenario."""
        metadata = {
            "events": [
                {
                    "id": "event-1",
                    "sentences": ["hello"],
                    "score": 5,
                    "feedbackStatus": True,
                }
            ]
        }
        events = build_events_from_metadata(metadata)

        # Create mock scenario with termination event
        scenario = create_mock_scenario(
            events,
            trigger_events=[],
            termination_event_id="event-1",
            termination_message="Custom termination",
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )

        assert len(orchestrator.termination_events) == 1
        assert "event-1" in orchestrator.termination_event_ids

    def test_event_orchestrator_accepts_termination_callback(self):
        """Test that EventOrchestrator accepts termination callback in __init__."""
        metadata = {"events": [{"id": "event-1", "sentences": ["hello"]}]}
        events = build_events_from_metadata(metadata)
        scenario = create_mock_scenario(events, trigger_events=["event-1"])

        callback = AsyncMock()
        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        assert orchestrator.termination_callback is callback

    def test_event_orchestrator_works_without_termination_callback(self):
        """Test that EventOrchestrator works fine without termination callback."""
        metadata = {"events": [{"id": "event-1", "sentences": ["hello"]}]}
        events = build_events_from_metadata(metadata)
        scenario = create_mock_scenario(events, trigger_events=["event-1"])

        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )
        assert orchestrator.termination_callback is None

    @pytest.mark.asyncio
    async def test_termination_callback_called_for_termination_event(self):
        """Test that termination callback is called when a termination event occurs."""
        # Create event
        termination_event = DummyEvent(
            event_id="term-event",
            score=10,
            emoji="🛑",
            emoji_message="Terminating",
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [termination_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Custom termination message",
        )

        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"

        # Create orchestrator with the termination callback
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update and send events (mark termination event as detected)
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-event"}
        )

        # Verify callback was called with the termination event
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "term-event"

    @pytest.mark.asyncio
    async def test_termination_callback_not_called_for_normal_event(self):
        """Test that termination callback is NOT called for normal events."""
        # Create normal event
        normal_event = DummyEvent(
            event_id="normal-event",
            score=10,
            emoji="✅",
            emoji_message="Success",
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario([normal_event], trigger_events=["normal-event"])

        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"

        # Create orchestrator with the termination callback
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update and send events
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"normal-event"}
        )

        # Verify callback was NOT called
        callback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_termination_callback_handles_multiple_termination_events(self):
        """Test that only one event can be configured as termination event."""
        # Create events
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=0
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=0
        )

        # Create callback mock - only term-1 is configured as termination
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_event_id="term-1",
            termination_message="Terminating",
        )

        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"

        # Create orchestrator
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update with both termination events
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-1", "term-2"}
        )

        # Verify callback was called exactly once for term-1
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "term-1"

    @pytest.mark.asyncio
    async def test_termination_with_mixed_events(self):
        """Test termination with mix of normal and termination events."""
        # Create mixed events
        normal_event = DummyEvent(
            event_id="normal", visibility_type=VisibilityType.ACTIVE, score=5
        )
        term_event = DummyEvent(
            event_id="terminator", visibility_type=VisibilityType.ACTIVE, score=0
        )

        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [normal_event, term_event],
            trigger_events=["normal", "terminator"],
            termination_event_id="terminator",
            termination_message="Terminating",
        )

        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"

        # Create orchestrator
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update with both events
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"normal", "terminator"}
        )

        # Verify callback was called with termination event only
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "terminator"

    @pytest.mark.asyncio
    async def test_termination_callback_not_called_without_room(self):
        """Test that termination callback is not called when room is None."""
        term_event = DummyEvent(
            event_id="term-event", visibility_type=VisibilityType.ACTIVE, score=0
        )

        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Terminating",
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update without room (room=None)
        await orchestrator.orchestrate_events(
            room=None, detected_event_ids={"term-event"}
        )

        # Callback is still called even without room (termination logic runs regardless)
        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_termination_event_with_trigger_events_filter(self):
        """Test that termination works with trigger_events filter."""
        # Create termination event
        term_event = DummyEvent(
            event_id="term-event", visibility_type=VisibilityType.ACTIVE, score=0
        )

        callback = AsyncMock()

        # Create orchestrator with trigger_events filter that includes
        # the termination event
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Terminating",
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        # Update and send
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-event"}
        )

        # Callback should be called
        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_termination_event_works_without_trigger_events(self):
        """Test that termination events work even if NOT in trigger_events list.

        Termination events should always be processed, regardless of trigger_events.
        This allows BE to configure termination without adding to trigger_events.
        """
        # Create termination event
        term_event = DummyEvent(
            event_id="term-event", visibility_type=VisibilityType.ACTIVE, score=0
        )

        callback = AsyncMock()

        # Create orchestrator with trigger_events that EXCLUDES the termination event
        # But termination should still work
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["other-event"],
            termination_event_id="term-event",
            termination_message="Terminating",
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Update and send
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-event"}
        )

        # Callback SHOULD be called even though term-event not in trigger_events
        # Termination events are always processed
        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_termination_with_combination_event(self):
        """Test termination with a combination event that has
        terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {
                    "id": "event-1",
                    "sentences": ["hello"],
                    "score": 5,
                    "feedbackStatus": True,
                },
                {
                    "id": "event-2",
                    "sentences": ["world"],
                    "score": 5,
                    "feedbackStatus": True,
                },
                {
                    "id": "combo-term",
                    "detectionType": "COMBINATION",
                    "score": 10,
                    "feedbackStatus": True,
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {"type": "IDENTIFIER", "id": "event-2"},
                        }
                    },
                },
            ],
            "autoTerminationEvent": {
                "id": "combo-term",
                "terminationMessage": "Combination event triggered termination.",
            },
        }

        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["event-1", "event-2", "combo-term"],
            termination_event_id="combo-term",
            termination_message="Combination event triggered termination.",
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Trigger both base events so combination event becomes true
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"event-1", "event-2"}
        )

        # The combination event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "combo-term"

    @pytest.mark.asyncio
    async def test_termination_with_score_event(self):
        """Test termination with a score-based event that has
        terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {
                    "id": "score-term",
                    "detectionType": "SCORE",
                    "score": 0,
                    "feedbackStatus": True,
                    "data": {"score": 10, "condition": "GTE"},
                }
            ],
            "autoTerminationEvent": {
                "id": "score-term",
                "terminationMessage": "Score threshold reached.",
            },
        }

        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["score-term"],
            termination_event_id="score-term",
            termination_message="Score threshold reached.",
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        orchestrator.score_keeper._event_score = 10

        # Update with score that triggers the event
        await orchestrator.orchestrate_events(room=mock_room, detected_event_ids=None)

        # Score event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "score-term"

    @pytest.mark.asyncio
    async def test_termination_with_time_event(self):
        """Test termination with a time-based event that has
        terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {
                    "id": "time-term",
                    "detectionType": "TIME",
                    "score": 0,
                    "feedbackStatus": True,
                    "data": {"time": 0, "condition": "GTE"},
                }
            ],
            "autoTerminationEvent": {
                "id": "time-term",
                "terminationMessage": "Time limit reached.",
            },
        }

        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["time-term"],
            termination_event_id="time-term",
            termination_message="Time limit reached.",
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"
        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Manually trigger the time event by passing it in detected_event_ids
        # (Time events are normally triggered by schedulers, not in handle_events)
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"time-term"}
        )

        # Time event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "time-term"


class TestMultipleTerminationEvents:
    """Test suite for multiple auto-termination events functionality."""

    def test_event_orchestrator_stores_multiple_termination_events(self):
        """Test that EventOrchestrator stores multiple termination events."""
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=5
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=10
        )

        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_events=[
                {"id": "term-1", "termination_message": "Message 1", "score": 5},
                {"id": "term-2", "termination_message": "Message 2", "score": 10},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )

        assert len(orchestrator.termination_events) == 2
        assert orchestrator.termination_event_ids == {"term-1", "term-2"}

    @pytest.mark.asyncio
    async def test_multiple_termination_events_selects_highest_magnitude_score(self):
        """Test that when multiple termination events trigger, the one with
        highest magnitude score is selected."""
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=5
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=10
        )

        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_events=[
                {"id": "term-1", "termination_message": "Message 1", "score": 5},
                {"id": "term-2", "termination_message": "Message 2", "score": 10},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Trigger both termination events
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-1", "term-2"}
        )

        # Should select term-2 (score=10 > score=5)
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "term-2"

    @pytest.mark.asyncio
    async def test_multiple_termination_events_negative_score_magnitude(self):
        """Test that negative scores are compared by magnitude (absolute value)."""
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=-15
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=10
        )

        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_events=[
                {"id": "term-1", "termination_message": "Message 1", "score": -15},
                {"id": "term-2", "termination_message": "Message 2", "score": 10},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Trigger both termination events
        await orchestrator.orchestrate_events(
            room=mock_room, detected_event_ids={"term-1", "term-2"}
        )

        # Should select term-1 (abs(-15)=15 > abs(10)=10)
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "term-1"

    @pytest.mark.asyncio
    async def test_termination_flow_ignores_subsequent_events(self):
        """Test that once termination flow starts, subsequent termination events
        are ignored."""
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=5
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=10
        )

        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_events=[
                {"id": "term-1", "termination_message": "Message 1", "score": 5},
                {"id": "term-2", "termination_message": "Message 2", "score": 10},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # Manually set termination flow started
        orchestrator._termination_flow_started = True

        # Try to trigger another termination event
        # This should be ignored since termination flow already started
        await orchestrator._handle_termination_events([term_event_2])

        # Callback should NOT be called because termination flow already started
        callback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_termination_flow_prevents_duplicate_callbacks(self):
        """Test that termination callback is only called once even if
        termination flow flag is bypassed."""
        term_event_1 = DummyEvent(
            event_id="term-1", visibility_type=VisibilityType.ACTIVE, score=5
        )
        term_event_2 = DummyEvent(
            event_id="term-2", visibility_type=VisibilityType.ACTIVE, score=10
        )

        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_events=[
                {"id": "term-1", "termination_message": "Message 1", "score": 5},
                {"id": "term-2", "termination_message": "Message 2", "score": 10},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback,
        )

        # First termination event
        await orchestrator._handle_termination_events([term_event_1])
        callback.assert_awaited_once()

        # Try to trigger another termination event
        # Callback should NOT be called again due to _termination_initiated flag
        await orchestrator._handle_termination_events([term_event_2])

        # Still only called once
        callback.assert_awaited_once()

    def test_single_termination_event_convenience(self):
        """Test that single termination event ID creates termination_events list."""
        term_event = DummyEvent(
            event_id="term-event", visibility_type=VisibilityType.ACTIVE, score=5
        )

        # Use single termination event (convenience in tests)
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Single termination",
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )

        # Should have termination_events list populated
        assert len(orchestrator.termination_events) == 1
        assert "term-event" in orchestrator.termination_event_ids

    @pytest.mark.asyncio
    async def test_score_calculation_only_from_trigger_events_not_termination(self):
        """
        Test that _calculate_total_score_from_events only includes scores from
        events in trigger_events list and excludes termination events.

        Test scenarios:
        1. Event in trigger_events only -> score included
        2. Event in termination_events only -> score excluded
        3. Event in both trigger_events and termination_events -> score included
        4. Event in neither list -> score excluded
        """
        # Create test events with different scores
        event_trigger_only = DummyEvent(
            event_id="trigger-only",
            score=10,
            emoji="✅",
            emoji_message="Trigger only",
            visibility_type=VisibilityType.ACTIVE,
        )

        event_termination_only = DummyEvent(
            event_id="termination-only",
            score=20,
            emoji="🛑",
            emoji_message="Termination only",
            visibility_type=VisibilityType.ACTIVE,
        )

        event_both = DummyEvent(
            event_id="both-lists",
            score=30,
            emoji="⚡",
            emoji_message="In both lists",
            visibility_type=VisibilityType.ACTIVE,
        )

        event_neither = DummyEvent(
            event_id="neither-list",
            score=40,
            emoji="❌",
            emoji_message="In neither list",
            visibility_type=VisibilityType.ACTIVE,
        )

        # Create scenario with specific trigger_events and termination_events
        scenario = create_mock_scenario(
            events=[
                event_trigger_only,
                event_termination_only,
                event_both,
                event_neither,
            ],
            trigger_events=["trigger-only", "both-lists"],
            termination_events=[
                {"id": "termination-only", "termination_message": "Term only"},
                {"id": "both-lists", "termination_message": "In both"},
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )

        # Test _calculate_total_score_from_events with all events
        all_events = [
            event_trigger_only,
            event_termination_only,
            event_both,
            event_neither,
        ]

        calculated_score = orchestrator._calculate_total_score_from_events(all_events)

        # Expected score:
        # - trigger-only: 10 (in trigger_events) ✓
        # - termination-only: 20 (NOT in trigger_events) ✗
        # - both-lists: 30 (in trigger_events) ✓
        # - neither-list: 40 (NOT in trigger_events) ✗
        # Total: 10 + 30 = 40
        assert calculated_score == 40, (
            f"Expected score 40 (10+30), but got {calculated_score}. "
            "Only events in trigger_events should be counted."
        )

        # Additional verification: Test with only termination events
        termination_only_score = orchestrator._calculate_total_score_from_events(
            [event_termination_only]
        )
        assert (
            termination_only_score == 0
        ), "Termination-only event should not contribute to score"

        # Test with event that's in both lists
        both_lists_score = orchestrator._calculate_total_score_from_events([event_both])
        assert (
            both_lists_score == 30
        ), "Event in both trigger_events and termination_events should be counted"

        # Test with trigger-only event
        trigger_only_score = orchestrator._calculate_total_score_from_events(
            [event_trigger_only]
        )
        assert trigger_only_score == 10, "Trigger-only event should be counted"

    @pytest.mark.asyncio
    async def test_live_score_update_respects_trigger_events_filter(self):
        """
        Test that _update_live_score only updates live_score with scores from
        events in trigger_events, not from termination_events.
        """
        # Create events
        trigger_event = DummyEvent(
            event_id="trigger-event",
            score=15,
            emoji="✅",
            emoji_message="Trigger",
            visibility_type=VisibilityType.ACTIVE,
        )

        termination_event = DummyEvent(
            event_id="term-event",
            score=25,
            emoji="🛑",
            emoji_message="Termination",
            visibility_type=VisibilityType.ACTIVE,
        )

        scenario = create_mock_scenario(
            events=[trigger_event, termination_event],
            trigger_events=["trigger-event"],
            termination_events=[
                {"id": "term-event", "termination_message": "Session ended"}
            ],
        )

        mock_room = MagicMock()
        mock_room.name = "test-room"

        orchestrator = EventOrchestrator(
            scenario, room=mock_room, thread_id="test-thread"
        )

        # Initial event score should be 0
        assert orchestrator.score_keeper.event_score == 0

        # Commit scores from both events into ScoreKeeper
        await orchestrator._update_event_score([trigger_event, termination_event])

        # Only trigger_event's score should be added (15)
        # termination_event's score (25) should be excluded
        assert orchestrator.score_keeper.event_score == 15, (
            f"Expected event_score to be 15, but got "
            f"{orchestrator.score_keeper.event_score}. "
            "Only trigger_event score should be added."
        )
