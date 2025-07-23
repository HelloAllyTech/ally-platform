"""
LiveKit token service.
"""
from datetime import timedelta
from typing import Optional

from livekit import api

from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


class TokenService:
    """Service for generating LiveKit access tokens."""
    
    def __init__(self):
        """Initialize the token service with API key and secret."""
        self.api_key = settings.LIVEKIT_API_KEY
        self.api_secret = settings.LIVEKIT_API_SECRET
    
    def create_participant_token(
        self,
        room_name: str,
        participant_identity: str,
        participant_name: Optional[str] = None,
        ttl_minutes: timedelta = timedelta(minutes=60),
        can_publish: bool = True,
        can_subscribe: bool = True,
        can_publish_data: bool = True
    ) -> str:
        """
        Create an access token for a participant to join a LiveKit room.
        
        Args:
            room_name: The name of the room to join.
            participant_identity: A unique identifier for the participant.
            participant_name: The display name of the participant (optional).
            ttl_minutes: Token time-to-live in minutes.
            can_publish: Whether the participant can publish audio/video.
            can_subscribe: Whether the participant can subscribe to other participants.
            can_publish_data: Whether the participant can publish data.
            
        Returns:
            str: The access token for the participant.
        """
        try:
            # Create a new token with API key and secret
            token = api.AccessToken(self.api_key, self.api_secret)
            
            # Set the identity
            token = token.with_identity(participant_identity)
            
            # Set the participant name if provided
            if participant_name:
                token = token.with_name(participant_name)
            
            # Set token expiration (ttl is in seconds)
            token = token.with_ttl(ttl_minutes * 60)
            
            # Create video grants with permissions
            grants = api.VideoGrants(
                room_join=True,
                room=room_name,
                can_publish=can_publish,
                can_subscribe=can_subscribe,
                can_publish_data=can_publish_data
            )
            
            # Add the grants to the token
            token = token.with_grants(grants)
            
            # Generate the token string
            return token.to_jwt()
        except Exception as e:
            logger.exception(f"Failed to create participant token: {str(e)}")
            raise


# Create a singleton instance
token_service = TokenService()
