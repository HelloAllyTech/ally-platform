"""
Tests for HELPER_INTERRUPTED event type.
"""

import pytest

from app.core.constants import DetectionType, VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.interruption.constants import InterruptionData
from app.core.events.event_types.interruption.interruption_event import (
    InterruptionEvent,
    get_interruption_detected,
    set_interruption_detected,
)
from app.core.events.factory import build_events_from_metadata


class DummyLogger:
    """Dummy logger for testing."""

    def __init__(self):
        self.warnings = []
        self.errors = []
        self.debugs = []
        self.infos = []
        self.exceptions = []

    def warning(self, msg, *args):
        self.warnings.append(msg % args if args else msg)

    def error(self, msg, *args):
        self.errors.append(msg % args if args else msg)

    def exception(self, msg, *args):
        self.exceptions.append(msg % args if args else msg)
        self.errors.append(msg % args if args else msg)

    def debug(self, msg, *args):
        self.debugs.append(msg % args if args else msg)

    def info(self, msg, *args):
        self.infos.append(msg % args if args else msg)


class TestInterruptionEvent:
    """Tests for InterruptionEvent detection logic using LiveKit's detection."""

    def setup_method(self):
        """Reset interruption flag before each test."""
        set_interruption_detected(False)

    @pytest.mark.asyncio
    async def test_detect_interruption_livekit_flag_set(self):
        """Test detection when LiveKit interruption flag is set."""
        event = InterruptionEvent.create(
            event_id="test-interruption",
            data=InterruptionData(),
        )

        # Set the interruption flag (simulating LiveKit detection)
        set_interruption_detected(True)
        assert get_interruption_detected() is True

        # Any messages - flag takes precedence
        messages = [
            ChatMessage(role="client", content="I'm speaking..."),
            ChatMessage(role="counselor", content="Wait, let me ask..."),
        ]
        result = await event.detect_event(messages)
        assert result is True
        # Flag should be reset after detection
        assert get_interruption_detected() is False

    @pytest.mark.asyncio
    async def test_no_interruption_flag_not_set(self):
        """Test that no interruption is detected when flag is not set."""
        event = InterruptionEvent.create(
            event_id="test-interruption",
            data=InterruptionData(),
        )

        # Flag is not set (default False)
        assert get_interruption_detected() is False

        # Even with counselor message after agent message
        messages = [
            ChatMessage(role="client", content="I'm speaking..."),
            ChatMessage(role="counselor", content="Wait, let me ask..."),
        ]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_interruption_flag_reset_after_detection(self):
        """Test that interruption flag is reset after being checked."""
        event = InterruptionEvent.create(
            event_id="test-interruption",
            data=InterruptionData(),
        )

        # Set flag
        set_interruption_detected(True)
        assert get_interruption_detected() is True

        # First detection should succeed and reset flag
        messages = [ChatMessage(role="counselor", content="Interrupting")]
        result1 = await event.detect_event(messages)
        assert result1 is True
        assert get_interruption_detected() is False

        # Second detection should fail (flag was reset)
        result2 = await event.detect_event(messages)
        assert result2 is False

    @pytest.mark.asyncio
    async def test_no_interruption_empty_conversations(self):
        """Test that empty conversations return False when flag not set."""
        event = InterruptionEvent.create(
            event_id="test-interruption",
            data=InterruptionData(),
        )

        messages = []
        result = await event.detect_event(messages)
        assert result is False


class TestInterruptionEventFactory:
    """Tests for building InterruptionEvent from metadata."""

    def test_build_interruption_event_from_metadata(self):
        """Test building interruption event from metadata."""
        metadata = {
            "events": [
                {
                    "id": "counselor-interruption",
                    "name": "Counselor Interrupted Agent",
                    "detectionType": "HELPER_INTERRUPTED",
                    "data": {},
                    "score": -3,
                    "emoji": "⚠️",
                    "message": "You interrupted the client.",
                    "branchInstruction": "I notice you interrupted me.",
                    "visibilityType": "ACTIVE",
                    "feedbackStatus": True,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], InterruptionEvent)
        assert events[0].event_id == "counselor-interruption"
        assert events[0].detection_type == DetectionType.HELPER_INTERRUPTED
        assert events[0].score == -3
        assert events[0].emoji == "⚠️"
        assert events[0].emoji_message == "You interrupted the client."
        assert events[0].branching_instruction.content == "I notice you interrupted me."
        assert events[0].visibility_type == VisibilityType.ACTIVE
        assert events[0].show_feedback is True

    def test_build_interruption_event_no_data(self):
        """Test building event with no data field (should still work)."""
        metadata = {
            "events": [
                {
                    "id": "interruption-1",
                    "detectionType": "HELPER_INTERRUPTED",
                    "score": -2,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], InterruptionEvent)
        assert events[0].event_id == "interruption-1"

    def test_build_interruption_event_empty_data(self):
        """Test building event with empty data dict."""
        metadata = {
            "events": [
                {
                    "id": "interruption-1",
                    "detectionType": "HELPER_INTERRUPTED",
                    "data": {},
                    "score": -2,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], InterruptionEvent)

    def test_build_mixed_event_types_including_interruption(self):
        """Test building multiple event types including interruption."""
        metadata = {
            "events": [
                {
                    "id": "similarity-1",
                    "sentences": ["hello"],
                    "detectionType": "SENTENCE_SIMILARITY",
                },
                {
                    "id": "interruption-1",
                    "detectionType": "HELPER_INTERRUPTED",
                    "data": {},
                },
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"minUtteranceLength": 1, "maxUtteranceLength": 25},
                },
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 3
        assert events[0].detection_type == DetectionType.SENTENCE_SIMILARITY
        assert events[1].detection_type == DetectionType.HELPER_INTERRUPTED
        assert events[2].detection_type == DetectionType.HELPER_UTTERANCE_LENGTH
