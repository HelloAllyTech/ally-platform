"""
LiveKit room endpoints.
"""
from typing import List
import json

from datetime import datetime, timezone
from fastapi import APIRouter, Depends, HTTPException, status

from app.core.dependencies import get_current_user, verify_admin_api_key
from app.core.models import User
from app.core.livekit.room_service import room_service
from app.core.livekit.token_service import token_service
from app.schemas.room import RoomResponse, RoomUpdate, RoomCreationResponse, RoomListResponse, RoomCreate
from app.utils.logger import get_logger
from app.utils.datetime_utils import timestamp_to_iso_utc

router = APIRouter()
logger = get_logger(__name__)

import random


@router.post("", response_model=RoomCreationResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
        room_data: RoomCreate,
        current_user: User = Depends(get_current_user)
) -> RoomCreationResponse:
    """
    Create a new LiveKit room using the current authenticated user.

    Args:
        room_data: Room creation data including optional script_type.
        current_user: Current authenticated user from JWT token.

    Returns:
        RoomCreationResponse: The created room with room ID, participant ID, access token and creation time.
    """
    try:
        # Generate a unique room ID using script_type and a random number
        random_number = random.randint(100000, 999999)  # 6-digit random number
        room_id = f"room_{room_data.script_type}_{random_number}"

        # Participant identity stays tied to user
        participant_id = f"user_{current_user.id}"

        # Create metadata JSON with the user info and script_type
        metadata = json.dumps({
            "user_id": current_user.id,
            "user_email": current_user.email,
            "script_type": room_data.script_type
        })

        # Create the room with the formatted room ID
        room = await room_service.create_room(
            name=room_id,
            metadata=metadata
        )

        # Generate access token for the participant
        access_token = token_service.create_participant_token(
            room_name=room_id,
            participant_identity=participant_id,
            participant_name="User"  # Default display name
        )

        # Use current time instead of relying on LiveKit's creation_time
        created_at = timestamp_to_iso_utc(room.creation_time)

        logger.info(f"Room created: {room_id}, script_type: {room_data.script_type}, creation time: {created_at}")

        return RoomCreationResponse(
            room_id=room.name,
            participant_id=participant_id,
            access_token=access_token,
            created_at=created_at
        )
    except Exception as e:
        logger.exception(f"Failed to create room: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create room: {type(e).__name__}"
        )


@router.get("", response_model=List[RoomListResponse])
async def list_rooms(
    _: bool = Depends(verify_admin_api_key)
) -> List[RoomListResponse]:
    """
    List all LiveKit rooms with simplified response (name, SID, and creation time).
    Requires admin API key authentication.
        
    Returns:
        List[RoomListResponse]: List of rooms with name, SID, and creation time.
    """
    try:
        rooms = await room_service.list_rooms()
        
        # Convert to simplified response models
        result = []
        for room in rooms:
            # Convert creation_time from Unix timestamp to ISO format
            created_at = timestamp_to_iso_utc(room.creation_time)
            
            result.append(RoomListResponse(
                sid=room.sid,
                name=room.name,
                created_at=created_at,
                metadata=room.metadata
            ))
        
        return result
    except Exception as e:
        logger.exception(f"Failed to list rooms: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list rooms: {type(e).__name__}"
        )


@router.delete("/{room_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_name: str,
    _: User = Depends(get_current_user)
) -> None:
    """
    Delete a LiveKit room.
    Requires user authentication.
    
    Args:
        room_name: The name of the room to delete.
    """
    try:
        await room_service.delete_room(room_name)
    except Exception as e:
        logger.exception(f"Failed to delete room: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete room: {type(e).__name__}"
        )


@router.patch("/{room_name}", response_model=RoomResponse)
async def update_room_metadata(
    room_name: str,
    room_update: RoomUpdate,
    _: bool = Depends(verify_admin_api_key)
) -> RoomResponse:
    """
    Update the metadata of a LiveKit room.
    Requires admin API key authentication.
    
    Args:
        room_name: The name of the room.
        room_update: The room update data.
        
    Returns:
        RoomResponse: The updated room.
    """
    try:
        room = await room_service.update_room_metadata(room_name, room_update.metadata)
        
        # Convert to response model using dict conversion
        room_dict = {
            "sid": room.sid,
            "name": room.name,
            "empty_timeout": room.empty_timeout,
            "max_participants": room.max_participants,
            "creation_time": room.creation_time,
            "turn_password": room.turn_password,
            "enabled_codecs": room.enabled_codecs,
            "metadata": room.metadata,
            "num_participants": room.num_participants,
            "active_recording": room.active_recording
        }
        
        return RoomResponse(**room_dict)
    except Exception as e:
        logger.exception(f"Failed to update room metadata: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update room metadata: {type(e).__name__}"
        )
