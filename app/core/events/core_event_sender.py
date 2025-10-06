import datetime
import time
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.events.base import ChatMessage
from app.utils import get_current_iso_timestamp


class CoreEventType(BaseModel):
    event_id: Optional[str] = None
    timestamp: Optional[str] = None  # store as ISO string for consistency

    @classmethod
    def create(cls, event_id: Optional[str] = None, timestamp: Optional[str] = None) -> "CoreEventType":
        if timestamp is None:
            timestamp = get_current_iso_timestamp()
        return cls(event_id=event_id, timestamp=timestamp)

class CoreEventMessageTypeData(BaseModel):
    chat_message: Optional[ChatMessage] = Field(default=None, description="Message from user or agent")
    event: Optional[CoreEventType] = Field(default=None, description="Event ID of an event")

class CoreEventMessageType(BaseModel):
    message_type: Literal["message", "event"]
    data: CoreEventMessageTypeData
    room_id: str
    timestamp: int

    @classmethod
    def create(cls, room_id: str, chat_message: Optional[ChatMessage] = None, event_id: Optional[str] = None) -> "CoreEventMessageType":
        event = None
        if event_id:
            event = CoreEventType.create(event_id=event_id)

        return cls(
            message_type="message" if chat_message else "event",
            data=CoreEventMessageTypeData(chat_message=chat_message, event=event),
            room_id=room_id,
            timestamp=int(time.time())
        )
