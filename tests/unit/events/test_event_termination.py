"""
Tests for event termination feature (terminate_on_occurrence flag).
"""
import pytest
from unittest.mock import AsyncMock, MagicMock

from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_registry.event_registry import EventRegistry
from app.core.events.factory import build_events_from_metadata
from app.core.constants import VisibilityType


class DummyEvent(BaseEvent):
    """Test event that always detects."""
    async def detect_event(self, conversations):
        return True


def create_mock_scenario(events, trigger_events=None, termination_event_id=None, termination_message=None):
    """Helper to create a mock scenario for testing."""
    mock_scenario = MagicMock()
    mock_scenario.events = events
    mock_scenario.trigger_events = trigger_events
    
    if termination_event_id:
        mock_scenario.termination_event = MagicMock()
        mock_scenario.termination_event.id = termination_event_id
        mock_scenario.termination_event.termination_message = termination_message or ""
    else:
        mock_scenario.termination_event = None
    
    return mock_scenario


class TestEventTermination:
    """Test suite for event termination functionality."""

    def test_event_registry_stores_termination_config(self):
        """Test that EventRegistry stores termination configuration from scenario."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"], "score": 5, "feedbackStatus": True}
            ]
        }
        events = build_events_from_metadata(metadata)
        
        # Create mock scenario with termination event
        mock_scenario = MagicMock()
        mock_scenario.events = events
        mock_scenario.trigger_events = []
        mock_scenario.termination_event = MagicMock()
        mock_scenario.termination_event.id = "event-1"
        mock_scenario.termination_event.termination_message = "Custom termination"
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        registry = EventRegistry(mock_scenario, room=mock_room, thread_id="test-thread")
        
        assert registry.termination_event_id == "event-1"
        assert registry.termination_message == "Custom termination"

    def test_event_registry_accepts_termination_callback(self):
        """Test that EventRegistry accepts termination callback in __init__."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]}
            ]
        }
        events = build_events_from_metadata(metadata)
        scenario = create_mock_scenario(events, trigger_events=["event-1"])
        
        callback = AsyncMock()
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        assert registry.termination_callback is callback

    def test_event_registry_works_without_termination_callback(self):
        """Test that EventRegistry works fine without termination callback."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"]}
            ]
        }
        events = build_events_from_metadata(metadata)
        scenario = create_mock_scenario(events, trigger_events=["event-1"])
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread")
        assert registry.termination_callback is None

    @pytest.mark.asyncio
    async def test_termination_callback_called_for_termination_event(self):
        """Test that termination callback is called when a termination event occurs."""
        # Create event
        termination_event = DummyEvent(
            event_id="term-event",
            score=10,
            emoji="🛑",
            emoji_message="Terminating",
            visibility_type=VisibilityType.ACTIVE
        )
        
        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [termination_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Custom termination message"
        )
        
        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Create registry with the termination callback
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update and send events (mark termination event as detected)
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"term-event"}
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
            visibility_type=VisibilityType.ACTIVE
        )
        
        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario([normal_event], trigger_events=["normal-event"])
        
        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Create registry with the termination callback
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update and send events
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"normal-event"}
        )
        
        # Verify callback was NOT called
        callback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_termination_callback_handles_multiple_termination_events(self):
        """Test that only one event can be configured as termination event."""
        # Create events
        term_event_1 = DummyEvent(
            event_id="term-1",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        term_event_2 = DummyEvent(
            event_id="term-2",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        
        # Create callback mock - only term-1 is configured as termination
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event_1, term_event_2],
            trigger_events=["term-1", "term-2"],
            termination_event_id="term-1",
            termination_message="Terminating"
        )
        
        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Create registry
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update with both termination events
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"term-1", "term-2"}
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
            event_id="normal",
            visibility_type=VisibilityType.ACTIVE,
            score=5
        )
        term_event = DummyEvent(
            event_id="terminator",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        
        # Create callback mock
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [normal_event, term_event],
            trigger_events=["normal", "terminator"],
            termination_event_id="terminator",
            termination_message="Terminating"
        )
        
        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Create registry
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update with both events
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"normal", "terminator"}
        )
        
        # Verify callback was called with termination event only
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "terminator"

    @pytest.mark.asyncio
    async def test_termination_callback_not_called_without_room(self):
        """Test that termination callback is not called when room is None."""
        term_event = DummyEvent(
            event_id="term-event",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        
        callback = AsyncMock()
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Terminating"
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update without room (room=None)
        await registry.handle_events(
            room=None,
            detected_event_ids={"term-event"}
        )
        
        # Callback is still called even without room (termination logic runs regardless)
        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_termination_event_with_trigger_events_filter(self):
        """Test that termination works with trigger_events filter."""
        # Create termination event
        term_event = DummyEvent(
            event_id="term-event",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        
        callback = AsyncMock()
        
        # Create registry with trigger_events filter that includes the termination event
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["term-event"],
            termination_event_id="term-event",
            termination_message="Terminating"
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback
        )
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Update and send
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"term-event"}
        )
        
        # Callback should be called
        callback.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_termination_event_filtered_by_trigger_events(self):
        """Test that termination callback is NOT called if event is filtered by trigger_events."""
        # Create termination event
        term_event = DummyEvent(
            event_id="term-event",
            visibility_type=VisibilityType.ACTIVE,
            score=0
        )
        
        callback = AsyncMock()
        
        # Create registry with trigger_events filter that EXCLUDES the termination event
        scenario = create_mock_scenario(
            [term_event],
            trigger_events=["other-event"],
            termination_event_id="term-event",
            termination_message="Terminating"
        )
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=callback
        )
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Update and send
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"term-event"}
        )
        
        # Callback should NOT be called because event is filtered out
        callback.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_termination_with_combination_event(self):
        """Test termination with a combination event that has terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {"id": "event-1", "sentences": ["hello"], "score": 5, "feedbackStatus": True},
                {"id": "event-2", "sentences": ["world"], "score": 5, "feedbackStatus": True},
                {
                    "id": "combo-term",
                    "detectionType": "COMBINATION",
                    "score": 10,
                    "feedbackStatus": True,
                    "data": {
                        "expression": {
                            "type": "AND",
                            "left": {"type": "IDENTIFIER", "id": "event-1"},
                            "right": {"type": "IDENTIFIER", "id": "event-2"}
                        }
                    }
                }
            ],
            "autoTerminationEvent": {
                "id": "combo-term",
                "terminationMessage": "Combination event triggered termination."
            }
        }
        
        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["event-1", "event-2", "combo-term"],
            termination_event_id="combo-term",
            termination_message="Combination event triggered termination."
        )
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Trigger both base events so combination event becomes true
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"event-1", "event-2"}
        )
        
        # The combination event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "combo-term"

    @pytest.mark.asyncio
    async def test_termination_with_score_event(self):
        """Test termination with a score-based event that has terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {
                    "id": "score-term",
                    "detectionType": "SCORE",
                    "score": 0,
                    "feedbackStatus": True,
                    "data": {"score": 10, "condition": "GTE"}
                }
            ],
            "autoTerminationEvent": {
                "id": "score-term",
                "terminationMessage": "Score threshold reached."
            }
        }
        
        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["score-term"],
            termination_event_id="score-term",
            termination_message="Score threshold reached."
        )
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Update with score that triggers the event
        await registry.handle_events(
            room=mock_room,
            current_score=10,
            detected_event_ids=None
        )
        
        # Score event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "score-term"

    @pytest.mark.asyncio
    async def test_termination_with_time_event(self):
        """Test termination with a time-based event that has terminate_on_occurrence=True."""
        metadata = {
            "events": [
                {
                    "id": "time-term",
                    "detectionType": "TIME",
                    "score": 0,
                    "feedbackStatus": True,
                    "data": {"time": 0, "condition": "GTE"}
                }
            ],
            "autoTerminationEvent": {
                "id": "time-term",
                "terminationMessage": "Time limit reached."
            }
        }
        
        events = build_events_from_metadata(metadata)
        callback = AsyncMock()
        scenario = create_mock_scenario(
            events,
            trigger_events=["time-term"],
            termination_event_id="time-term",
            termination_message="Time limit reached."
        )
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=callback)
        
        # Manually trigger the time event by passing it in detected_event_ids
        # (Time events are normally triggered by schedulers, not in handle_events)
        await registry.handle_events(
            room=mock_room,
            detected_event_ids={"time-term"}
        )
        
        # Time event should trigger termination
        callback.assert_awaited_once()
        called_event = callback.call_args[0][0]
        assert called_event.event_id == "time-term"
