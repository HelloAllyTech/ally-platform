import json

from livekit import rtc
from typing import Optional
from pydantic import BaseModel, Field
from app.utils.datetime_utils import get_current_iso_timestamp

from app.utils import get_logger

logger = get_logger(__name__)


class CustomUIEventMessageTypeData(BaseModel):
    """Schema for custom event data payload."""

    score: Optional[int] = Field(None, description="Event score")
    emoji: Optional[str] = Field(..., description="Event emoji")
    message: Optional[str] = Field(..., description="Event message")
    show_feedback: bool = Field(..., description="Show feedback button")


class CustomUIEventMessageType(BaseModel):
    """Schema for custom event sent to frontend."""

    version: str = Field(default="1.0", description="Event format version")
    data: CustomUIEventMessageTypeData = Field(..., description="Event data payload")
    timestamp: str = Field(..., description="ISO timestamp when event occurred")

    @classmethod
    def create(
            cls,
            score: Optional[int],
            emoji: Optional[str],
            message: Optional[str],
            timestamp: Optional[str] = None,
            show_feedback: Optional[bool] = True,
    ) -> "CustomUIEventMessageType":
        """Create a custom event with current timestamp."""
        if timestamp is None:
            timestamp = get_current_iso_timestamp()

        return cls(
            version="1.0",
            data=CustomUIEventMessageTypeData(score=score, emoji=emoji, message=message,show_feedback=show_feedback),
            timestamp=timestamp
        )

async def send_event(event_data: CustomUIEventMessageType, room: rtc.Room) -> bool:
    """
    Send a custom event to the frontend in the specified format.

    Args:
        event_data: Dictionary containing event information with keys:
        room: Room object to send event to

    Returns:
        bool: True if event was sent successfully, False otherwise
    """
    try:

        if not event_data.data.show_feedback:
            # Set emoji to null when show_feedback is False
            event_data.data.emoji = None
            event_data.data.message = None

        event_data_bytes = json.dumps(event_data.model_dump()).encode('utf-8')
        await room.local_participant.publish_data(
            event_data_bytes,
            topic="events",
            reliable=True
        )

        logger.debug("Custom event sent to UI")

        return True

    except Exception as e:
        logger.debug(f"Failed to send custom event to frontend: {type(e).__name__}")
        return False
