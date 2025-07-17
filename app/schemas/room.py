"""
Schemas for LiveKit room operations.
"""
from typing import Any, List, Optional
from datetime import datetime

from pydantic import BaseModel, Field


class RoomResponse(BaseModel):
    """Schema for room response."""
    
    sid: str = Field(..., description="Room SID")
    name: str = Field(..., description="Room name")
    empty_timeout: int = Field(..., description="Empty timeout in seconds")
    max_participants: int = Field(..., description="Maximum number of participants")
    creation_time: int = Field(..., description="Room creation time")
    turn_password: str = Field(..., description="TURN password")
    enabled_codecs: Any = Field(..., description="Enabled codecs")
    metadata: Optional[str] = Field(None, description="Room metadata")
    num_participants: int = Field(..., description="Number of participants")
    active_recording: bool = Field(..., description="Whether recording is active")
    
    model_config = {"arbitrary_types_allowed": True}


class RoomListResponse(BaseModel):
    """Simplified schema for room list response."""
    
    sid: str = Field(..., description="Room SID")
    name: str = Field(..., description="Room name")
    created_at: str = Field(..., description="Room creation time in ISO format")


class RoomCreationResponse(BaseModel):
    """Simplified schema for room creation response."""
    
    room_id: str = Field(..., description="Room ID")
    participant_id: str = Field(..., description="Participant ID")
    access_token: str = Field(..., description="LiveKit access token")
    created_at: str = Field(..., description="Room creation time in ISO format")


class RoomUpdate(BaseModel):
    """Schema for updating a room."""
    
    metadata: str = Field(..., description="New metadata for the room")


class RoomDelete(BaseModel):
    """Schema for deleting a room."""
    
    name: str = Field(..., description="Name of the room to delete")
