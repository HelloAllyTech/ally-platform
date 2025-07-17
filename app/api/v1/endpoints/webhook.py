"""
LiveKit webhook endpoints.
"""
import logging

from fastapi import APIRouter, HTTPException, Request, Response, status
from fastapi.responses import JSONResponse
from livekit.api import TokenVerifier
from livekit.api.webhook import WebhookReceiver

from app.core.config import settings

router = APIRouter()
logger = logging.getLogger(__name__)


@router.post("/livekit", status_code=status.HTTP_200_OK)
async def livekit_webhook(request: Request) -> Response:
    """
    Webhook endpoint for LiveKit Cloud events.
    
    This endpoint receives webhook events from LiveKit Cloud and logs them to the console.
    Configure this URL in the Settings section of your LiveKit Cloud project dashboard.
    
    Args:
        request: The incoming webhook request.
        
    Returns:
        Response: A simple acknowledgment response.
    """
    try:
        # Get the raw body and headers
        body = await request.body()
        auth_header = request.headers.get("Authorization")
        
        if not auth_header:
            logger.error("Missing Authorization header in webhook request")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Missing Authorization header"
            )
        
        # Check content type
        content_type = request.headers.get("Content-Type")
        if content_type != "application/webhook+json":
            logger.warning(f"Unexpected Content-Type: {content_type}, expected 'application/webhook+json'")
        
        # Create webhook receiver with API key and secret
        token_verifier = TokenVerifier(settings.LIVEKIT_API_KEY, settings.LIVEKIT_API_SECRET)
        receiver = WebhookReceiver(token_verifier)
        
        try:
            # Verify and parse the webhook event
            event = receiver.receive(body.decode(), auth_header)
            
            # Log the event details
            event_type = event.event
            logger.info(f"Received LiveKit webhook event: {event_type} (id: {event.id})")
            
            # Handle different event types
            if event_type == "room_started":
                logger.info(f"Room started: {event.room.name} (sid: {event.room.sid})")
            elif event_type == "room_finished":
                logger.info(f"Room finished: {event.room.name} (sid: {event.room.sid})")
            elif event_type == "participant_joined":
                logger.info(f"Participant joined: {event.participant.identity} (name: {event.participant.name}) in room {event.room.name}")
            elif event_type == "participant_left":
                logger.info(f"Participant left: {event.participant.identity} (name: {event.participant.name}) from room {event.room.name}")
            elif event_type == "track_published":
                logger.info(f"Track published by: {event.participant.identity} in room {event.room.name}, track type: {event.track.type}")
            elif event_type == "track_unpublished":
                logger.info(f"Track unpublished by: {event.participant.identity} in room {event.room.name}, track type: {event.track.type}")
            elif event_type == "egress_started":
                logger.info(f"Egress started: {event.egress_info.egress_id}")
            elif event_type == "egress_updated":
                logger.info(f"Egress updated: {event.egress_info.egress_id}, status: {event.egress_info.status}")
            elif event_type == "egress_ended":
                logger.info(f"Egress ended: {event.egress_info.egress_id}, status: {event.egress_info.status}")
            elif event_type == "ingress_started":
                logger.info(f"Ingress started: {event.ingress_info.ingress_id}")
            elif event_type == "ingress_ended":
                logger.info(f"Ingress ended: {event.ingress_info.ingress_id}")
            else:
                # Log the full event for other event types
                logger.info(f"Other event: {event_type}")
                logger.debug(f"Event details: {event}")
            
            # Return a simple 200 OK response
            return JSONResponse(content={"status": "success", "event": event_type})
            
        except Exception as e:
            logger.exception(f"Failed to verify webhook: {str(e)}")
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"Invalid webhook payload: {str(e)}"
            )
            
    except Exception as e:
        logger.exception(f"Error processing webhook: {str(e)}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Error processing webhook: {str(e)}"
        )
