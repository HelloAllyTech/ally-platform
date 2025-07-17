"""
LiveKit room service.
"""
from typing import List, Optional

from livekit.api import (
    CreateRoomRequest,
    DeleteRoomRequest,
    ListRoomsRequest,
    Room,
    RoomEgress,
    UpdateRoomMetadataRequest
)

from app.core.livekit.livekit_client import livekit_client
import logging

logger = logging.getLogger(__name__)


class RoomService:
    """Service for managing LiveKit rooms."""
    
    async def create_room(
        self, 
        name: str, 
        empty_timeout: int = 10 * 60,  # 10 minutes in seconds
        max_participants: int = 2,
        metadata: Optional[str] = None
    ) -> Room:
        """
        Create a new LiveKit room.
        
        Args:
            name: The name of the room.
            empty_timeout: Time in seconds before an empty room is closed.
            max_participants: Maximum number of participants allowed.
            metadata: Optional metadata for the room.
            
        Returns:
            Room: The created room.
        """
        try:
            request = CreateRoomRequest(
                name=name,
                empty_timeout=empty_timeout,
                max_participants=max_participants,
                metadata=metadata
            )
            
            return await livekit_client.room.create_room(request)
        except Exception as e:
            logger.exception(f"Failed to create LiveKit room: {str(e)}")
            raise
    
    async def list_rooms(self) -> List[Room]:
        """
        List all LiveKit rooms.
        
        Returns:
            List[Room]: List of rooms.
        """
        try:
            request = ListRoomsRequest()
            rooms_response = await livekit_client.room.list_rooms(request)
            return rooms_response.rooms
        except Exception as e:
            logger.exception(f"Failed to list LiveKit rooms: {str(e)}")
            raise
    
    async def delete_room(self, room_name: str) -> None:
        """
        Delete a LiveKit room.
        
        Args:
            room_name: The name of the room to delete.
        """
        try:
            request = DeleteRoomRequest(room=room_name)
            await livekit_client.room.delete_room(request)
        except Exception as e:
            logger.exception(f"Failed to delete LiveKit room: {str(e)}")
            raise
    
    async def update_room_metadata(self, room_name: str, metadata: str) -> Room:
        """
        Update the metadata of a LiveKit room.
        
        Args:
            room_name: The name of the room.
            metadata: The new metadata.
            
        Returns:
            Room: The updated room.
        """
        try:
            request = UpdateRoomMetadataRequest(room=room_name, metadata=metadata)
            return await livekit_client.room.update_room_metadata(request)
        except Exception as e:
            logger.exception(f"Failed to update LiveKit room metadata: {str(e)}")
            raise


# Create a singleton instance
room_service = RoomService()
