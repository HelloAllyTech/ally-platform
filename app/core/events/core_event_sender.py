import datetime
import time
from typing import Optional, Literal

from pydantic import BaseModel, Field

from app.core.events.base import ChatMessage, BaseEvent
from app.utils import get_current_iso_timestamp


class CoreEventType(BaseModel):
    event_data: dict = None
    timestamp: Optional[str] = None  # store as ISO string for consistency

    @classmethod
    def create(
        cls, timestamp: Optional[str] = None, event_data: dict = None
    ) -> "CoreEventType":
        if timestamp is None:
            timestamp = get_current_iso_timestamp()
        return cls(timestamp=timestamp, event_data=event_data)


class CoreEventMessageTypeData(BaseModel):
    chat_message: Optional[ChatMessage] = Field(
        default=None, description="Message from user or agent"
    )
    event: Optional[CoreEventType] = Field(
        default=None, description="Event ID of an event"
    )


class CoreEventMessageType(BaseModel):
    message_type: Literal["message", "event"]
    data: CoreEventMessageTypeData
    room_id: str
    timestamp: int

    @classmethod
    def create(
        cls,
        room_id: str,
        chat_message: Optional[ChatMessage] = None,
        event_data: dict = None,
    ) -> "CoreEventMessageType":
        event = None
        if event_data:
            event = CoreEventType.create(event_data=event_data)

        return cls(
            message_type="message" if chat_message else "event",
            data=CoreEventMessageTypeData(chat_message=chat_message, event=event),
            room_id=room_id,
            timestamp=int(time.time()),
        )
