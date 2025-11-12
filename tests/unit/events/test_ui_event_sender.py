import json
import pytest
from typing import Optional

from app.core.events.ui_event_sender import (
    CustomUIEventMessageType,
    CustomUIEventMessageTypeData,
    CustomUIEventSender,
    send_event,
)


class FakeParticipant:
    def __init__(self):
        self.published = []
        self.raise_error = False

    async def publish_data(self, data: bytes, topic: str, reliable: bool):
        if self.raise_error:
            raise RuntimeError("publish failed")
        # store for assertions
        self.published.append({
            "data": data,
            "topic": topic,
            "reliable": reliable,
        })


class FakeRoom:
    def __init__(self, participant: Optional[FakeParticipant] = None):
        self.local_participant = participant or FakeParticipant()


# --- Tests ---
class TestUIEventSender:
    def test_custom_ui_event_message_type_create_with_defaults(self):
        # Test standard creation with defaults (show_feedback=True)
        msg = CustomUIEventMessageType.create(
            score=3,
            emoji=":)",
            message="ok",
            timestamp="2020-01-01T00:00:00.000Z"
        )
        assert msg.version == "1.0"

        assert msg.data == CustomUIEventMessageTypeData(
            score=3,
            emoji=":)",
            message="ok",
            show_feedback=True
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
            score=1,
            emoji=":)",
            message="yay",
            timestamp="2024-01-01T00:00:00.000Z"
        )

        ok = await send_event(evt, room)
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
    async def test_send_event_skips_when_show_feedback_false(self):
        """Test that the standalone function respects the show_feedback flag."""
        room = FakeRoom()
        # Create event with show_feedback=False
        evt = CustomUIEventMessageType.create(
            score=1,
            emoji=":)",
            message="hidden",
            show_feedback=False
        )

        ok = await send_event(evt, room)

        # Should return False (skipped) AND not have published anything
        assert ok is False
        assert len(room.local_participant.published) == 0

    @pytest.mark.asyncio
    async def test_send_event_function_failure(self):
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(score=1, emoji=":)", message="yay")

        # Failure path
        room.local_participant.raise_error = True
        ok = await send_event(evt, room)
        assert ok is False

    @pytest.mark.asyncio
    async def test_custom_ui_event_sender_class_wrapper(self):
        participant = FakeParticipant()
        room = FakeRoom(participant)
        sender = CustomUIEventSender(room_name="room-1", room=room)

        evt = CustomUIEventMessageType.create(
            score=0,
            emoji="*",
            message="info",
            timestamp="2024-02-02T00:00:00.000Z"
        )
        ok = await sender.send_event(evt)

        assert ok is True
        assert len(participant.published) == 1
        payload = participant.published[-1]
        data = json.loads(payload["data"].decode("utf-8"))
        assert data["data"]["message"] == "info"