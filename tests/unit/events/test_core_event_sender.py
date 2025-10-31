import re

from app.core.events.base import ChatMessage
from app.core.events.core_event_sender import (
    CoreEventType,
    CoreEventMessageType,
)


def test_core_event_type_create_uses_provided_timestamp():
    ts = "2024-01-01T00:00:00Z"
    ev = CoreEventType.create(event_id="E1", timestamp=ts)
    assert ev.event_id == "E1"
    assert ev.timestamp == ts


def test_core_event_message_create_event_only_builds_event_payload():
    msg = CoreEventMessageType.create(room_id="room-1", chat_message=None, event_id="E2")
    assert msg.message_type == "event"
    assert msg.room_id == "room-1"
    assert msg.data.event is not None and msg.data.event.event_id == "E2"
    assert msg.data.chat_message is None
    # timestamp is int seconds
    assert isinstance(msg.timestamp, int)


def test_core_event_message_create_with_chat_message_builds_message_payload():
    chat = ChatMessage(role="user", content="hello")
    msg = CoreEventMessageType.create(room_id="r", chat_message=chat, event_id=None)
    assert msg.message_type == "message"
    assert msg.data.chat_message == chat
    assert msg.data.event is None
