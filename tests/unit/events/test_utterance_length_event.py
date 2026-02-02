"""
Tests for HELPER_UTTERANCE_LENGTH event type.
"""

import pytest

from app.core.constants import DetectionType, VisibilityType
from app.core.events.base import ChatMessage
from app.core.events.event_types.utterance_length.constants import UtteranceLengthData
from app.core.events.event_types.utterance_length.utterance_length_event import (
    UtteranceLengthEvent,
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


class TestUtteranceLengthData:
    """Tests for UtteranceLengthData validation."""

    def test_valid_range(self):
        """Test that valid min/max ranges are accepted."""
        data = UtteranceLengthData(min_utterance_length=1, max_utterance_length=25)
        assert data.min_utterance_length == 1
        assert data.max_utterance_length == 25

    def test_valid_min_only(self):
        """Test that minUtteranceLength only (greater than) is valid."""
        data = UtteranceLengthData(min_utterance_length=200)
        assert data.min_utterance_length == 200
        assert data.max_utterance_length is None

    def test_valid_max_only(self):
        """Test that maxUtteranceLength only (less than) is valid."""
        data = UtteranceLengthData(max_utterance_length=50)
        assert data.min_utterance_length == 0
        assert data.max_utterance_length == 50

    def test_valid_no_limits_with_defaults(self):
        """Test that no limits provided uses defaults (min=0, max=None)."""
        data = UtteranceLengthData()
        assert data.min_utterance_length == 0
        assert data.max_utterance_length is None

    def test_valid_explicit_none_values(self):
        """Test that explicit None values are supported for both min and max."""
        data = UtteranceLengthData(min_utterance_length=None, max_utterance_length=None)
        assert data.min_utterance_length is None
        assert data.max_utterance_length is None

    def test_invalid_min_greater_than_max(self):
        """Test that minUtteranceLength cannot be greater than maxUtteranceLength."""
        with pytest.raises(
            ValueError,
            match="minUtteranceLength must be less than or equal to maxUtteranceLength",
        ):
            UtteranceLengthData(min_utterance_length=100, max_utterance_length=50)

    def test_valid_equal_min_max(self):
        """Test that minUtteranceLength can equal maxUtteranceLength."""
        data = UtteranceLengthData(min_utterance_length=50, max_utterance_length=50)
        assert data.min_utterance_length == 50
        assert data.max_utterance_length == 50


class TestUtteranceLengthEvent:
    """Tests for UtteranceLengthEvent detection logic."""

    @pytest.mark.asyncio
    async def test_detect_range_match(self):
        """Test detection when message length is within range."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Message with 15 characters (within range)
        test_message = "A" * 15
        messages = [ChatMessage(role="counselor", content=test_message)]
        assert len(messages[0].content) == 15
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_detect_range_boundary_min(self):
        """Test detection at minimum boundary."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Message with exactly 1 character
        messages = [ChatMessage(role="counselor", content="H")]
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_detect_range_boundary_max(self):
        """Test detection at maximum boundary."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Message with exactly 25 characters
        messages = [ChatMessage(role="counselor", content="A" * 25)]
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_detect_range_below_min(self):
        """Test detection when message is below minimum."""
        event = UtteranceLengthEvent.create(
            event_id="test-26-50",
            data=UtteranceLengthData(min_utterance_length=26, max_utterance_length=50),
        )

        # Message with 25 characters (below min)
        messages = [ChatMessage(role="counselor", content="A" * 25)]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_range_above_max(self):
        """Test detection when message is above maximum."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Message with 26 characters (above max)
        messages = [ChatMessage(role="counselor", content="A" * 26)]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_min_only_greater_than(self):
        """Test detection with only minUtteranceLength (greater than)."""
        event = UtteranceLengthEvent.create(
            event_id="test-gt-200",
            data=UtteranceLengthData(min_utterance_length=201),
        )

        # Message with 250 characters (>= 201)
        messages = [ChatMessage(role="counselor", content="A" * 250)]
        result = await event.detect_event(messages)
        assert result is True

        # Message with 200 characters (< 201)
        messages = [ChatMessage(role="counselor", content="A" * 200)]
        result = await event.detect_event(messages)
        assert result is False

        # Message with exactly 201 characters (>= 201)
        messages = [ChatMessage(role="counselor", content="A" * 201)]
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_detect_max_only_less_than(self):
        """Test detection with only maxUtteranceLength (less than)."""
        event = UtteranceLengthEvent.create(
            event_id="test-lt-50",
            data=UtteranceLengthData(max_utterance_length=50),
        )

        # Message with 49 characters (<= 50)
        messages = [ChatMessage(role="counselor", content="A" * 49)]
        result = await event.detect_event(messages)
        assert result is True

        # Message with 51 characters (> 50)
        messages = [ChatMessage(role="counselor", content="A" * 51)]
        result = await event.detect_event(messages)
        assert result is False

        # Message with exactly 50 characters (<= 50)
        messages = [ChatMessage(role="counselor", content="A" * 50)]
        result = await event.detect_event(messages)
        assert result is True

    @pytest.mark.asyncio
    async def test_detect_client_message_ignored(self):
        """Test that client messages are ignored."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Client message (should be ignored)
        messages = [ChatMessage(role="client", content="Hello")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_case_insensitive_role(self):
        """Test that role matching is case-insensitive."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Test various case combinations
        for role in ["counselor", "COUNSELOR", "Counselor", "CoUnSeLoR"]:
            messages = [ChatMessage(role=role, content="Hello")]
            result = await event.detect_event(messages)
            assert result is True, f"Failed for role: {role}"

    @pytest.mark.asyncio
    async def test_detect_empty_message(self):
        """Test detection with empty message."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Empty message (0 characters)
        messages = [ChatMessage(role="counselor", content="")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_none_content_handled(self):
        """Test that the detection logic handles None content gracefully."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        # Note: ChatMessage doesn't allow None content, but the detection
        # logic should handle it if it somehow occurs (defensive programming)
        # We test with empty string instead, which is the valid equivalent
        messages = [ChatMessage(role="counselor", content="")]
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_empty_conversations(self):
        """Test detection with empty conversation list."""
        event = UtteranceLengthEvent.create(
            event_id="test-1-25",
            data=UtteranceLengthData(min_utterance_length=1, max_utterance_length=25),
        )

        messages = []
        result = await event.detect_event(messages)
        assert result is False

    @pytest.mark.asyncio
    async def test_detect_checks_last_message_only(self):
        """Test that only the most recent message is checked."""
        event = UtteranceLengthEvent.create(
            event_id="test-151-200",
            data=UtteranceLengthData(
                min_utterance_length=151, max_utterance_length=200
            ),
        )

        # First message: 50 chars (doesn't match)
        # Last message: 175 chars (matches)
        messages = [
            ChatMessage(role="counselor", content="A" * 50),
            ChatMessage(role="counselor", content="B" * 175),
        ]
        result = await event.detect_event(messages)
        assert result is True  # Should match the last message

    @pytest.mark.asyncio
    async def test_all_ranges_from_scenario(self):
        """Test all the ranges defined in scenario_sample.py."""
        ranges = [
            (1, 25, 15),  # 1-25, test with 15
            (26, 50, 40),  # 26-50, test with 40
            (51, 100, 75),  # 51-100, test with 75
            (101, 150, 125),  # 101-150, test with 125
            (151, 200, 175),  # 151-200, test with 175
            (201, None, 250),  # >200, test with 250
            (501, None, 600),  # >500, test with 600
        ]

        for min_len, max_len, test_len in ranges:
            if max_len is None:
                data = UtteranceLengthData(min_utterance_length=min_len)
            else:
                data = UtteranceLengthData(
                    min_utterance_length=min_len, max_utterance_length=max_len
                )

            event = UtteranceLengthEvent.create(
                event_id=f"test-{min_len}-{max_len or 'gt'}",
                data=data,
            )

            messages = [ChatMessage(role="counselor", content="A" * test_len)]
            result = await event.detect_event(messages)
            assert (
                result is True
            ), f"Failed for range {min_len}-{max_len} with {test_len} chars"


class TestUtteranceLengthEventFactory:
    """Tests for building UtteranceLengthEvent from metadata."""

    def test_build_utterance_length_event_from_metadata(self):
        """Test building utterance length event from metadata."""
        metadata = {
            "events": [
                {
                    "id": "utterance-length-1-25",
                    "name": "Short Utterance",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"minUtteranceLength": 1, "maxUtteranceLength": 25},
                    "score": 2,
                    "emoji": "💬",
                    "message": "Your response was brief.",
                    "visibilityType": "ACTIVE",
                    "feedbackStatus": True,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert isinstance(events[0], UtteranceLengthEvent)
        assert events[0].event_id == "utterance-length-1-25"
        assert events[0].detection_type == DetectionType.HELPER_UTTERANCE_LENGTH
        assert events[0].data.min_utterance_length == 1
        assert events[0].data.max_utterance_length == 25
        assert events[0].score == 2
        assert events[0].emoji == "💬"
        assert events[0].emoji_message == "Your response was brief."
        assert events[0].visibility_type == VisibilityType.ACTIVE
        assert events[0].show_feedback is True

    def test_build_utterance_length_event_min_only(self):
        """Test building event with only minUtteranceLength."""
        metadata = {
            "events": [
                {
                    "id": "utterance-length-gt-200",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"minUtteranceLength": 201},
                    "score": 7,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert events[0].data.min_utterance_length == 201
        assert events[0].data.max_utterance_length is None

    def test_build_utterance_length_event_max_only(self):
        """Test building event with only maxUtteranceLength."""
        metadata = {
            "events": [
                {
                    "id": "utterance-length-lt-50",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"maxUtteranceLength": 50},
                    "score": 3,
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert events[0].data.min_utterance_length == 0
        assert events[0].data.max_utterance_length == 50

    def test_build_utterance_length_event_missing_data_warns(self):
        """Test that missing data field warns and skips event."""
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    # missing data
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any(
            "missing" in w.lower() or "invalid" in w.lower() for w in logger.warnings
        )

    def test_build_utterance_length_event_invalid_data_warns(self):
        """Test that invalid data warns and skips event."""
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"minUtteranceLength": "not-a-number"},  # invalid
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any("invalid" in w.lower() for w in logger.warnings)

    def test_build_utterance_length_event_invalid_range_warns(self):
        """Test that invalid range (min > max) warns and skips event."""
        logger = DummyLogger()
        metadata = {
            "events": [
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {
                        "minUtteranceLength": 100,
                        "maxUtteranceLength": 50,
                    },  # invalid
                }
            ]
        }

        events = build_events_from_metadata(metadata, on_unknown="warn", logger=logger)
        assert len(events) == 0
        assert any("invalid" in w.lower() for w in logger.warnings)

    def test_build_utterance_length_event_no_limits_succeeds(self):
        """Test that missing both limits uses defaults (min=0, max=None)."""
        metadata = {
            "events": [
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {},  # no limits, should use defaults
                }
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 1
        assert events[0].data.min_utterance_length == 0
        assert events[0].data.max_utterance_length is None

    def test_build_mixed_event_types_including_utterance_length(self):
        """Test building multiple event types including utterance length."""
        metadata = {
            "events": [
                {
                    "id": "similarity-1",
                    "sentences": ["hello"],
                    "detectionType": "SENTENCE_SIMILARITY",
                },
                {
                    "id": "utterance-length-1",
                    "detectionType": "HELPER_UTTERANCE_LENGTH",
                    "data": {"minUtteranceLength": 1, "maxUtteranceLength": 25},
                },
                {
                    "id": "time-1",
                    "detectionType": "TIME",
                    "data": {"time": 100.0, "condition": "LTE"},
                },
            ]
        }

        events = build_events_from_metadata(metadata)
        assert len(events) == 3
        assert events[0].detection_type == DetectionType.SENTENCE_SIMILARITY
        assert events[1].detection_type == DetectionType.HELPER_UTTERANCE_LENGTH
        assert events[2].detection_type == DetectionType.TIME
