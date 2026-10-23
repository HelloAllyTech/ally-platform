import json
from typing import Optional

import pytest

from app.core.events.handlers import send_event_to_ui
from app.core.events.schemas import (
    CustomUIEventMessageType,
    CustomUIEventMessageTypeData,
)


class FakeParticipant:
    def __init__(self):
        self.published = []
        self.raise_error = False

    async def publish_data(self, data: bytes, topic: str, reliable: bool):
        if self.raise_error:
            raise RuntimeError("publish failed")
        # store for assertions
        self.published.append(
            {
                "data": data,
                "topic": topic,
                "reliable": reliable,
            }
        )


class FakeRoom:
    def __init__(self, participant: Optional[FakeParticipant] = None):
        self.local_participant = participant or FakeParticipant()


# --- Tests ---
class TestUIEventSender:
    def test_custom_ui_event_message_type_create_with_defaults(self):
        # Test standard creation with defaults (show_feedback=True)
        msg = CustomUIEventMessageType.create(
            score=3, emoji=":)", message="ok", timestamp="2020-01-01T00:00:00.000Z"
        )
        assert msg.version == "1.0"

        assert msg.data == CustomUIEventMessageTypeData(
            score=3, emoji=":)", message="ok", show_feedback=True
        )
        assert msg.timestamp == "2020-01-01T00:00:00.000Z"

    def test_custom_ui_event_message_type_create_without_timestamp(self):
        msg = CustomUIEventMessageType.create(score=None, emoji=":(", message="bad")
        assert isinstance(msg.timestamp, str) and len(msg.timestamp) > 0
        assert msg.data.show_feedback is True

    @pytest.mark.asyncio
    async def test_send_event_function_success(self):
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(
            score=1, emoji=":)", message="yay", timestamp="2024-01-01T00:00:00.000Z"
        )

        ok = await send_event_to_ui(evt, room)
        assert ok is True

        assert len(room.local_participant.published) == 1
        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))

        assert sent["version"] == "1.0"
        assert sent["data"]["score"] == 1
        assert sent["data"]["show_feedback"] is True
        assert payload["topic"] == "events"
        assert payload["reliable"] is True

    @pytest.mark.asyncio
    async def test_send_event_sets_emoji_and_message_null_when_show_feedback_false(
        self,
    ):
        """Test that the standalone function sets emoji and message to
        null when show_feedback is False."""
        room = FakeRoom()
        # Create event with show_feedback=False
        evt = CustomUIEventMessageType.create(
            score=1, emoji=":)", message="hidden", show_feedback=False
        )

        ok = await send_event_to_ui(evt, room)

        # Should return True (sent) and emoji should be null
        assert ok is True
        assert len(room.local_participant.published) == 1

        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))

        assert sent["version"] == "1.0"
        assert sent["data"]["score"] == 1
        assert sent["data"]["emoji"] is None  # emoji should be null
        assert sent["data"]["message"] is None
        assert sent["data"]["show_feedback"] is False
        assert payload["topic"] == "events"
        assert payload["reliable"] is True

    @pytest.mark.asyncio
    async def test_send_event_function_failure(self):
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(score=1, emoji=":)", message="yay")

        # Failure path
        room.local_participant.raise_error = True
        ok = await send_event_to_ui(evt, room)
        assert ok is False

    @pytest.mark.asyncio
    async def test_send_event_with_null_emoji_initially(self):
        """Test that event can be created with null emoji from the start."""
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(
            score=2, emoji=None, message="no emoji", show_feedback=True
        )

        ok = await send_event_to_ui(evt, room)
        assert ok is True

        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))

        assert sent["data"]["emoji"] is None
        assert sent["data"]["show_feedback"] is True

    @pytest.mark.asyncio
    async def test_send_event_preserves_emoji_when_show_feedback_true(self):
        """Test that emoji is preserved when show_feedback is True."""
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(
            score=5, emoji="🎉", message="celebration", show_feedback=True
        )

        ok = await send_event_to_ui(evt, room)
        assert ok is True

        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))

        assert sent["data"]["emoji"] == "🎉"
        assert sent["data"]["show_feedback"] is True

    @pytest.mark.asyncio
    async def test_send_event_with_detected_event_ids(self):
        """Test that detected_event_ids are passed through."""
        room = FakeRoom()
        event_ids = ["event1", "event2"]
        evt = CustomUIEventMessageType.create(
            score=10,
            emoji="✅",
            message="Events detected",
            show_feedback=True,
            detected_event_ids=event_ids,
        )

        ok = await send_event_to_ui(evt, room)
        assert ok is True

        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))

        assert sent["data"]["detected_event_ids"] == event_ids
