import time
import pytest
from typing import List

from app.core.events.base import ChatMessage, BaseEvent, VisibilityType
from app.core.events.core_event_sender import CoreEventType, CoreEventMessageType



class DummyEvent(BaseEvent):
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        # Simple placeholder implementation
        return any("trigger" in msg.content for msg in conversations)



def test_core_event_type_create_uses_provided_timestamp():
    ts = "2024-01-01T00:00:00Z"
    dummy_event = DummyEvent(event_id="E1", visibility_type=VisibilityType.ACTIVE)
    ev = CoreEventType.create(timestamp=ts, event_data=dummy_event)

    assert isinstance(ev, CoreEventType)
    assert ev.timestamp == ts
    assert isinstance(ev.event_data, DummyEvent)
    assert ev.event_data.event_id == "E1"
    assert ev.event_data.visibility_type == VisibilityType.ACTIVE


def test_core_event_type_create_generates_timestamp_when_missing():
    dummy_event = DummyEvent(event_id="E2")
    ev = CoreEventType.create(event_data=dummy_event)

    assert isinstance(ev.timestamp, str)
    assert "T" in ev.timestamp  # ISO-like format
    assert ev.event_data.event_id == "E2"



def test_core_event_message_create_event_only_builds_event_payload():
    dummy_event = DummyEvent(event_id="E3")
    msg = CoreEventMessageType.create(room_id="room-1", event_data=dummy_event)

    assert msg.message_type == "event"
    assert msg.room_id == "room-1"
    assert msg.data.chat_message is None
    assert msg.data.event is not None
    assert isinstance(msg.data.event.event_data, DummyEvent)
    assert msg.data.event.event_data.event_id == "E3"
    assert isinstance(msg.timestamp, int)
    assert abs(msg.timestamp - int(time.time())) < 3


def test_core_event_message_create_with_chat_message_builds_message_payload():
    chat = ChatMessage(role="user", content="hello world")
    msg = CoreEventMessageType.create(room_id="room-2", chat_message=chat)

    assert msg.message_type == "message"
    assert msg.room_id == "room-2"
    assert msg.data.chat_message == chat
    assert msg.data.event is None
    assert isinstance(msg.timestamp, int)
