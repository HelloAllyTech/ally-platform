"""
Schemas for custom events sent to frontend.
"""
from typing import Optional
from datetime import datetime
from pydantic import BaseModel, Field
from app.utils.datetime_utils import get_current_iso_timestamp


class CustomEventData(BaseModel):
    """Schema for custom event data payload."""
    
    score: Optional[int] = Field(None, description="Event score")
    emoji: str = Field(..., description="Event emoji")
    message: str = Field(..., description="Event message")


class CustomEvent(BaseModel):
    """Schema for custom event sent to frontend."""
    
    version: str = Field(default="1.0", description="Event format version")
    data: CustomEventData = Field(..., description="Event data payload")
    timestamp: str = Field(..., description="ISO timestamp when event occurred")
    
    @classmethod
    def create(
        cls,
        score: Optional[int],
        emoji: str,
        message: str,
        timestamp: Optional[str] = None
    ) -> "CustomEvent":
        """Create a custom event with current timestamp."""
        if timestamp is None:
            timestamp = get_current_iso_timestamp()
        
        return cls(
            version="1.0",
            data=CustomEventData(
                score=score,
                emoji=emoji,
                message=message
            ),
            timestamp=timestamp
        ) 