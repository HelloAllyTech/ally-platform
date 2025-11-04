import asyncio
import json
import pytest

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
    def __init__(self, participant: FakeParticipant | None = None):
        self.local_participant = participant or FakeParticipant()


class TestUIEventSender:
    def test_custom_ui_event_message_type_create_with_and_without_timestamp(self):
        # Explicit timestamp passed through
        msg = CustomUIEventMessageType.create(score=3, emoji=":)", message="ok", timestamp="2020-01-01T00:00:00.000Z")
        assert msg.version == "1.0"
        assert msg.data == CustomUIEventMessageTypeData(score=3, emoji=":)", message="ok")
        assert msg.timestamp == "2020-01-01T00:00:00.000Z"

        # No assertion on actual now() value, just ensure a non-empty string when omitted
        msg2 = CustomUIEventMessageType.create(score=None, emoji=":(", message="bad")
        assert isinstance(msg2.timestamp, str) and len(msg2.timestamp) > 0

    @pytest.mark.asyncio
    async def test_send_event_function_success_and_failure(self):
        room = FakeRoom()
        evt = CustomUIEventMessageType.create(score=1, emoji=":)", message="yay", timestamp="2024-01-01T00:00:00.000Z")

        ok = await send_event(evt, room)
        assert ok is True

        # Validate payload contents
        payload = room.local_participant.published[-1]
        sent = json.loads(payload["data"].decode("utf-8"))
        assert sent["version"] == "1.0"
        assert sent["data"]["score"] == 1
        assert payload["topic"] == "events" and payload["reliable"] is True

        # Failure path
        room.local_participant.raise_error = True
        ok2 = await send_event(evt, room)
        assert ok2 is False

    @pytest.mark.asyncio
    async def test_custom_ui_event_sender_class_wrapper(self):
        participant = FakeParticipant()
        room = FakeRoom(participant)
        sender = CustomUIEventSender(room_name="room-1", room=room)

        evt = CustomUIEventMessageType.create(score=0, emoji="*", message="info", timestamp="2024-02-02T00:00:00.000Z")
        ok = await sender.send_event(evt)
        assert ok is True
        payload = participant.published[-1]
        data = json.loads(payload["data"].decode("utf-8"))
        assert data["data"]["message"] == "info"
