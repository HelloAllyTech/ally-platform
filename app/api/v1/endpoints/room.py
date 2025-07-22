"""
LiveKit room endpoints.
"""
from typing import List
import json
import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from fastapi.encoders import jsonable_encoder

from app.core.auth.auth_service import auth_service
from app.core.livekit.room_service import room_service
from app.core.livekit.token_service import token_service
from app.schemas.room import RoomResponse, RoomUpdate, RoomCreationResponse, RoomListResponse, RoomCreate

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("", response_model=RoomCreationResponse, status_code=status.HTTP_201_CREATED)
async def create_room(
    room_data: RoomCreate,
    session_id: str = Depends(auth_service.get_current_session_id)
) -> RoomCreationResponse:
    """
    Create a new LiveKit room using the session ID from the JWT token.
    
    Args:
        room_data: Room creation data including optional script_type.
        session_id: The session ID from the JWT token.
        
    Returns:
        RoomCreationResponse: The created room with room ID, participant ID, access token and creation time.
    """
    try:
        # TODO: script_type is currently passed due to Livekit not returning metadata
        # Format room name and participant identity
        # Include script_type in the room name since metadata isn't being passed back
        room_id = f"room_{room_data.script_type}_{session_id}"
        participant_id = f"user_{session_id}"
        
        # Create metadata JSON with the session_id and script_type
        metadata = json.dumps({
            "session_id": session_id,
            "script_type": room_data.script_type
        })
        
        # Create the room with the formatted room ID
        room = await room_service.create_room(
            name=room_id,  # Use formatted room ID as name with script_type included
            metadata=metadata  # Store session_id and script_type in metadata
        )
        
        # Generate access token for the participant
        access_token = token_service.create_participant_token(
            room_name=room_id,
            participant_identity=participant_id,
            participant_name="User"  # Default display name
        )
        
        # Use current time instead of relying on LiveKit's creation_time
        # This ensures we have the correct current time in ISO format
        created_at = datetime.utcfromtimestamp(room.creation_time).isoformat() + "Z"
        
        logger.info(f"Room created: {room_id}, script_type: {room_data.script_type}, creation time: {created_at}")
        
        # Return response with room ID, participant ID, access token and creation time
        return RoomCreationResponse(
            room_id=room.name,
            participant_id=participant_id,
            access_token=access_token,
            created_at=created_at
        )
    except Exception as e:
        logger.exception(f"Failed to create room: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to create room: {str(e)}"
        )


@router.get("", response_model=List[RoomListResponse])
async def list_rooms(
    session_id: str = Depends(auth_service.get_current_session_id)
) -> List[RoomListResponse]:
    """
    List all LiveKit rooms with simplified response (name, SID, and creation time).
    
    Args:
        session_id: The session ID from the token.
        
    Returns:
        List[RoomListResponse]: List of rooms with name, SID, and creation time.
    """
    try:
        rooms = await room_service.list_rooms()
        
        # Convert to simplified response models
        result = []
        for room in rooms:
            # Convert creation_time from Unix timestamp to ISO format
            created_at = datetime.utcfromtimestamp(room.creation_time).isoformat() + "Z"
            
            result.append(RoomListResponse(
                sid=room.sid,
                name=room.name,
                created_at=created_at
            ))
        
        return result
    except Exception as e:
        logger.exception(f"Failed to list rooms: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to list rooms: {str(e)}"
        )


@router.delete("/{room_name}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_room(
    room_name: str,
    session_id: str = Depends(auth_service.get_current_session_id)
) -> None:
    """
    Delete a LiveKit room.
    
    Args:
        room_name: The name of the room to delete.
        session_id: The session ID from the token.
    """
    try:
        await room_service.delete_room(room_name)
    except Exception as e:
        logger.exception(f"Failed to delete room: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to delete room: {str(e)}"
        )


@router.patch("/{room_name}", response_model=RoomResponse)
async def update_room_metadata(
    room_name: str,
    room_update: RoomUpdate,
    session_id: str = Depends(auth_service.get_current_session_id)
) -> RoomResponse:
    """
    Update the metadata of a LiveKit room.
    
    Args:
        room_name: The name of the room.
        room_update: The room update data.
        session_id: The session ID from the token.
        
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
        logger.exception(f"Failed to update room metadata: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to update room metadata: {str(e)}"
        )
