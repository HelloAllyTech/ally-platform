#!/usr/bin/env python3
"""
Standalone custom event sender for therapy sessions.
This module can be imported and used to send custom events to the frontend
in the specified format.
"""

import json
import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from livekit import rtc, api
from app.core.config import settings
from app.utils.logger import get_logger
from app.schemas.events import CustomEvent

logger = get_logger(__name__)


class CustomEventSender:
    """Standalone class for sending custom events to LiveKit frontend."""
    
    def __init__(self, room_name: str = "default-room", room: Optional[rtc.Room] = None):
        self.room_name = room_name
        self.room = room  # Use existing room connection if available
        self.livekit_url = settings.LIVEKIT_URL
        self.api_key = settings.LIVEKIT_API_KEY
        self.api_secret = settings.LIVEKIT_API_SECRET
    
    async def send_event(self, event_data: Dict[str, Any]) -> bool:
        """
        Send a custom event to the frontend in the specified format.
        
        Args:
            event_data: Dictionary containing event information with keys:
                      - score: int or None
                      - emoji: str
                      - message: str
                      - name: str (optional, for logging)
        
        Returns:
            bool: True if event was sent successfully, False otherwise
        """
        try:
            # Create structured event using data class
            custom_event = CustomEvent.create(
                score=event_data.get("score"),
                emoji=event_data.get("emoji"),
                message=event_data.get("message")
            )
            
            # If we have an existing room connection, use it
            await self._send_event_via_existing_room(custom_event, event_data)
            
            return True
            
        except Exception as e:
            logger.debug(f"Failed to send custom event to frontend: {type(e).__name__}")
            return False
    
    async def _send_event_via_existing_room(self, custom_event: CustomEvent, event_data: Dict[str, Any]):
        """Send event using existing room connection (preferred method)"""
        # Send event as data message using existing room connection
        event_data_bytes = json.dumps(custom_event.model_dump()).encode('utf-8')
        await self.room.local_participant.publish_data(
            event_data_bytes,
            topic="events",
            reliable=True
        )
        
        logger.debug(f"Custom event sent to frontend: {event_data.get('name', 'Unknown Event')}")
        logger.debug(f"   Room: {self.room_name}")
        logger.debug(f"   Event: {custom_event.model_dump()}")
    
