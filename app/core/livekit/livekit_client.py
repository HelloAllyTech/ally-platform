"""
LiveKit API client.
"""
from livekit import api

from app.core.config import settings


class LiveKitClient:
    """LiveKit API client wrapper."""
    
    def __init__(self):
        """Initialize the LiveKit client."""
        self.api_key = settings.LIVEKIT_API_KEY
        self.api_secret = settings.LIVEKIT_API_SECRET
        self.url = settings.LIVEKIT_URL
        self.client = api.LiveKitAPI(
            url=self.url,
            api_key=self.api_key,
            api_secret=self.api_secret
        )
    
    @property
    def room(self):
        """Get the room API client."""
        return self.client.room


# Create a singleton instance
livekit_client = LiveKitClient()
