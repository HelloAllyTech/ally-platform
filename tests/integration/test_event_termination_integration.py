"""
Integration tests for event termination feature.
Tests the full workflow from event detection to session termination.
"""
import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.events.base import ChatMessage
from app.core.events.factory import build_events_from_metadata
from app.core.events.event_registry.event_registry import EventRegistry


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


class TestEventTerminationIntegration:
    """Integration tests for event termination feature."""

    @pytest.mark.asyncio
    async def test_full_termination_workflow_with_sentence_similarity(self):
        """Test complete workflow: event detection -> registry update -> termination callback."""
        # Define scenario metadata with a termination event
        metadata = {
            "events": [
                {
                    "id": "end-session",
                    "sentences": ["goodbye", "end session", "terminate"],
                    "score": 0,
                    "emoji": "👋",
                    "message": "Session ended",
                    "feedbackStatus": True
                },
                {
                    "id": "normal-event",
                    "sentences": ["hello", "hi"],
                    "score": 5,
                    "emoji": "👋",
                    "message": "Greeting detected",
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "end-session",
                "terminationMessage": "Session is ending now."
            }
        }
        
        # Build events from metadata
        events = build_events_from_metadata(metadata)
        assert len(events) == 2
        
        # Get events for testing
        end_session_event = next(e for e in events if e.event_id == "end-session")
        normal_event = next(e for e in events if e.event_id == "normal-event")
        
        # Create mock termination callback
        termination_callback = AsyncMock()
        
        # Mock room
        mock_room = MagicMock()
        mock_room.name = "test-room-123"
        
        # Initialize registry with termination callback
        scenario = create_mock_scenario(
            events,
            trigger_events=["end-session", "normal-event"],
            termination_event_id="end-session",
            termination_message="Session is ending now."
        )
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=termination_callback)
        
        # Simulate conversation that should NOT trigger termination
        conversations = [
            ChatMessage(role="counselor", content="Hello there!")
        ]
        
        # Detect events manually
        normal_detected = await normal_event.detect_event(conversations)
        term_detected = await end_session_event.detect_event(conversations)
        
        assert normal_detected is True
        assert term_detected is False
        
        # Update registry - should not trigger termination
        await registry.handle_events(
            detected_event_ids={"normal-event"},
            room=mock_room
        )
        
        termination_callback.assert_not_awaited()
        
        # Now simulate conversation with termination trigger
        conversations_with_termination = [
            ChatMessage(role="counselor", content="Hello there!"),
            ChatMessage(role="counselor", content="Goodbye, let's end session now")
        ]
        
        # Detect events
        term_detected = await end_session_event.detect_event(conversations_with_termination)
        assert term_detected is True
        
        # Update registry - should trigger termination
        await registry.handle_events(
            detected_event_ids={"end-session"},
            room=mock_room
        )
        
        # Verify termination callback was called
        termination_callback.assert_awaited_once()
        called_event = termination_callback.call_args[0][0]
        assert called_event.event_id == "end-session"

    @pytest.mark.asyncio
    async def test_termination_with_score_based_event(self):
        """Test termination triggered by a score-based event."""
        metadata = {
            "events": [
                # Score-based termination event
                {
                    "id": "max-score-reached",
                    "detectionType": "SCORE",
                    "data": {"score": 50, "condition": "GTE"},
                    "emoji": "🎯",
                    "message": "Maximum score reached",
                    "score": 0,
                    "feedbackStatus": True
                },
                # Combination event (not terminating)
                {
                    "id": "combo-event",
                    "detectionType": "COMBINATION",
                    "score": 5,
                    "feedbackStatus": True,
                    "data": {
                        "expression": {
                            "type": "IDENTIFIER",
                            "id": "greeting"
                        }
                    }
                },
                {
                    "id": "greeting",
                    "sentences": ["hello", "hi"],
                    "score": 5,
                    "emoji": "👋",
                    "message": "Greeting detected",
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "max-score-reached",
                "terminationMessage": "Maximum score reached. Session ending."
            }
        }
        
        events = build_events_from_metadata(metadata)
        assert len(events) == 3
        
        termination_callback = AsyncMock()
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        scenario = create_mock_scenario(
            events,
            trigger_events=["max-score-reached", "combo-event", "greeting"],
            termination_event_id="max-score-reached",
            termination_message="Maximum score reached. Session ending."
        )
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=termination_callback)

        registry.live_score = 10
        # First update with greeting - should not terminate
        await registry.handle_events(
            detected_event_ids={"greeting"},
            room=mock_room,
        )
        
        termination_callback.assert_not_awaited()

        registry.live_score = 50

        # Update with high score - should trigger termination
        await registry.handle_events(
            detected_event_ids=None,
            room=mock_room,
        )
        
        # Verify termination was triggered by score event
        termination_callback.assert_awaited_once()
        called_event = termination_callback.call_args[0][0]
        assert called_event.event_id == "max-score-reached"

    @pytest.mark.asyncio
    async def test_termination_event_serialization(self):
        """Test that terminate_on_occurrence and termination_message are properly serialized."""
        from app.core.graph.utils import serialize_event
        
        metadata = {
            "events": [
                {
                    "id": "term-event",
                    "sentences": ["end"],
                    "score": 10,
                    "emoji": "🛑"
                }
            ],
            "autoTerminationEvent": {
                "id": "term-event",
                "terminationMessage": "Custom termination message"
            }
        }
        
        events = build_events_from_metadata(metadata)
        event = events[0]
        
        # Serialize the event with termination config
        serialized = serialize_event(
            event,
            termination_event_id="term-event",
            termination_message="Custom termination message"
        )
        
        # Verify terminate_on_occurrence and termination_message are in serialized form
        assert "autoTerminationStatus" in serialized
        assert serialized["autoTerminationStatus"] is True
        assert serialized["id"] == "term-event"
        assert "terminationMessage" in serialized
        assert serialized["terminationMessage"] == "Custom termination message"

    @pytest.mark.asyncio
    async def test_termination_does_not_prevent_event_sending(self):
        """Test that termination events are deferred and UI events are sent before termination callback."""
        metadata = {
            "events": [
                {
                    "id": "final-event",
                    "sentences": ["final words"],
                    "score": 10,
                    "emoji": "🏁",
                    "message": "Final event",
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "final-event",
                "terminationMessage": "Final words spoken."
            }
        }
        
        events = build_events_from_metadata(metadata)
        
        # Track call order
        call_order = []
        
        async def mock_termination_callback(event):
            call_order.append("termination")
        
        # Mock room and message queue
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        scenario = create_mock_scenario(
            events,
            trigger_events=["final-event"],
            termination_event_id="final-event",
            termination_message="Final words spoken."
        )
        registry = EventRegistry(scenario, room=mock_room, thread_id="test-thread", termination_callback=mock_termination_callback)
        
        # Patch the message queue to track when events are sent
        with patch('app.core.events.event_registry.event_registry.msg_event_queue') as mock_queue:
            mock_queue.send_message = AsyncMock(side_effect=lambda **kwargs: call_order.append("send_to_core"))
            
            with patch('app.core.events.event_registry.event_registry.send_event_to_ui') as mock_ui:
                mock_ui.side_effect = lambda *args: call_order.append("send_to_ui")
                
                # Trigger the termination event
                await registry.handle_events(
                    detected_event_ids={"final-event"},
                    room=mock_room
                )
        
        # Verify UI event was sent and termination callback was called
        assert "send_to_ui" in call_order
        assert "termination" in call_order
        
        # Termination event should NOT be sent to Core immediately (it's deferred)
        # It will be sent later in the shutdown callback
        assert "send_to_core" not in call_order
        
        # Termination should be last
        assert call_order[-1] == "termination"
        
        # Verify the termination event was deferred
        assert registry.deferred_termination_event is not None
        assert registry.deferred_termination_event.event_id == "final-event"

    @pytest.mark.asyncio
    async def test_deferred_termination_event_sent_in_shutdown(self):
        """Test that termination events are deferred and can be sent in shutdown callback."""
        metadata = {
            "events": [
                {
                    "id": "session-end",
                    "sentences": ["goodbye"],
                    "score": 0,
                    "emoji": "👋",
                    "message": "Session ending",
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "session-end",
                "terminationMessage": "Goodbye! Session is ending."
            }
        }
        
        events = build_events_from_metadata(metadata)
        termination_callback = AsyncMock()
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        scenario = create_mock_scenario(
            events,
            trigger_events=["session-end"],
            termination_event_id="session-end",
            termination_message="Goodbye! Session is ending."
        )
        registry = EventRegistry(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=termination_callback
        )
        
        # Initially, no deferred event
        assert registry.deferred_termination_event is None
        
        # Trigger the termination event
        with patch('app.core.events.event_registry.event_registry.msg_event_queue') as mock_queue:
            mock_queue.send_message = AsyncMock()
            
            await registry.handle_events(
                detected_event_ids={"session-end"},
                room=mock_room
            )
            
            # Verify termination event was NOT sent to Core immediately
            mock_queue.send_message.assert_not_called()
        
        # Verify the event was deferred
        assert registry.deferred_termination_event is not None
        assert registry.deferred_termination_event.event_id == "session-end"
        
        # Verify termination callback was still called
        termination_callback.assert_awaited_once()
        
        # Now simulate sending the deferred event in shutdown callback
        from app.core.graph.utils import serialize_event
        from app.core.events.schemas import CoreEventMessageType
        
        with patch('app.core.events.event_registry.event_registry.msg_event_queue') as mock_queue:
            mock_queue.send_message = AsyncMock()
            
            # This is what happens in the shutdown callback
            event_dict = serialize_event(
                registry.deferred_termination_event,
                termination_event_id=registry.termination_event_id,
                termination_message=registry.termination_message
            )
            core_event_message = CoreEventMessageType.create(
                room_id=mock_room.name, event_data=event_dict
            )
            await mock_queue.send_message(
                message_body=core_event_message.model_dump_json()
            )
            
            # Verify the event was sent with autoTerminationStatus=true
            mock_queue.send_message.assert_awaited_once()
            sent_message = mock_queue.send_message.call_args[1]["message_body"]
            import json
            sent_data = json.loads(sent_message)
            # The structure is: data -> event -> event_data
            assert sent_data["data"]["event"]["event_data"]["autoTerminationStatus"] is True
            assert sent_data["data"]["event"]["event_data"]["id"] == "session-end"

    @pytest.mark.asyncio
    async def test_termination_event_respects_trigger_events_filter(self):
        """Test that termination respects trigger_events filter."""
        metadata = {
            "events": [
                {
                    "id": "visible-term",
                    "sentences": ["visible end"],
                    "score": 0,
                    "feedbackStatus": True
                },
                {
                    "id": "hidden-term",
                    "sentences": ["hidden end"],
                    "score": 0,
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "visible-term",
                "terminationMessage": "Visible termination."
            }
        }
        
        events = build_events_from_metadata(metadata)
        termination_callback = AsyncMock()
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Only "visible-term" should be sent
        scenario = create_mock_scenario(
            events,
            trigger_events=["visible-term"],
            termination_event_id="visible-term",
            termination_message="Visible termination."
        )
        registry = EventRegistry(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=termination_callback
        )
        
        # Trigger hidden-term (should be filtered)
        await registry.handle_events(
            detected_event_ids={"hidden-term"},
            room=mock_room
        )
        
        # Should not terminate because event is filtered
        termination_callback.assert_not_awaited()
        
        # Trigger visible-term (should not be filtered)
        await registry.handle_events(
            detected_event_ids={"visible-term"},
            room=mock_room
        )
        
        # Should terminate
        termination_callback.assert_awaited_once()
        called_event = termination_callback.call_args[0][0]
        assert called_event.event_id == "visible-term"

    @pytest.mark.asyncio
    async def test_termination_with_custom_message_from_scenario(self):
        """Test that termination event uses custom message from autoTerminationEvent configuration."""
        # Define scenario metadata with autoTerminationEvent configuration
        metadata = {
            "events": [
                {
                    "id": "end-abruptly",
                    "sentences": ["I'm leaving", "goodbye"],
                    "score": 0,
                    "emoji": "👋",
                    "message": "Client is leaving",
                    "visibilityType": "ACTIVE",
                    "detectionType": "SENTENCE_SIMILARITY",
                    "feedbackStatus": True
                }
            ],
            "autoTerminationEvent": {
                "id": "end-abruptly",
                "terminationMessage": "I dont have time for this. I am leaving."
            }
        }
        
        # Build events from metadata
        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        
        # Verify the event was created
        event = events[0]
        assert event.event_id == "end-abruptly"
        
        # Create mock termination callback
        termination_callback = AsyncMock()
        
        mock_room = MagicMock()
        mock_room.name = "test-room"
        
        # Create registry with termination callback
        scenario = create_mock_scenario(
            events,
            trigger_events=["end-abruptly"],
            termination_event_id="end-abruptly",
            termination_message="I dont have time for this. I am leaving."
        )
        registry = EventRegistry(
            scenario,
            room=mock_room,
            thread_id="test-thread",
            termination_callback=termination_callback
        )
        
        # Trigger the termination event
        await registry.handle_events(
            detected_event_ids={"end-abruptly"},
            room=mock_room
        )
        
        # Verify termination callback was called with the event
        termination_callback.assert_awaited_once()
        called_event = termination_callback.call_args[0][0]
        assert called_event.event_id == "end-abruptly"
