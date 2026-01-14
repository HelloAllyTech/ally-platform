"""Conversation event handlers for LiveKit sessions."""

import asyncio
import json
from datetime import datetime

from livekit import rtc
from livekit.agents import ConversationItemAddedEvent

from app.core.events.base import ChatMessage
from app.core.events.schemas import CoreEventMessageType, CustomUIEventMessageType
from app.core.queue import msg_event_queue
from app.utils.logger import get_logger

logger = get_logger(__name__)


def extract_content(item) -> str:
    """Extract text content from conversation item."""
    if isinstance(item.content, str):
        return item.content
    elif isinstance(item.content, list):
        return "".join(item.content)
    return ""


def calculate_start_time(event_timestamp: float, joined_iso: str) -> float:
    """Calculate relative start time from agent join timestamp."""
    if not event_timestamp:
        return None

    joined_ts = datetime.fromisoformat(joined_iso.replace("Z", "+00:00")).timestamp()
    return event_timestamp - joined_ts


async def send_event_to_queue(event_data: str) -> None:
    """Safely send event to message queue."""
    try:
        await msg_event_queue.send_message(event_data)
    except Exception as e:
        logger.error(f"Failed to send event to queue: {e}")


def create_conversation_handler(room_id: str, joined_iso: str):
    """
    Factory function to create conversation event handler with deduplication.

    Args:
        room_id: LiveKit room identifier
        joined_iso: ISO timestamp when agent joined

    Returns:
        Tuple of (handler_function, cleanup_function):
        - handler_function: Event handler for conversation_item_added events
        - cleanup_function: Function to clean up internal state (call on shutdown)
    """
    seen_utterances = set()

    def on_conversation_item_added(event: ConversationItemAddedEvent):
        content = extract_content(event.item)

        # Deduplication: Use content + timestamp as unique key
        # This prevents processing the same utterance multiple times,
        # which can happen when transcription publishing fails and retries
        utterance_key = (content, event.created_at)

        if utterance_key in seen_utterances:
            logger.debug(
                f"Skipping duplicate utterance: {content[:50]}..."
                f" (timestamp: {event.created_at})"
            )
            return

        seen_utterances.add(utterance_key)

        role = "CLIENT" if event.item.role == "assistant" else "COUNSELOR"

        chat_message = ChatMessage(
            role=role,
            content=content,
            start_time=calculate_start_time(event.created_at, joined_iso),
            end_time=None,
        )

        core_event = CoreEventMessageType.create(
            room_id=room_id,
            chat_message=chat_message,
        )

        logger.debug(f"Enqueuing {role} message to SQS")

        # Schedule async send without blocking
        try:
            asyncio.create_task(send_event_to_queue(core_event.model_dump_json()))
        except RuntimeError:
            # Fallback for contexts without running loop
            asyncio.get_event_loop().create_task(
                send_event_to_queue(core_event.model_dump_json())
            )

    def cleanup():
        """Clean up the seen_utterances set."""
        count = len(seen_utterances)
        seen_utterances.clear()
        logger.debug(f"Cleaned up {count} utterance entries from conversation handler")

    return on_conversation_item_added, cleanup


async def send_event_to_ui(
    event_data: CustomUIEventMessageType, room: rtc.Room
) -> bool:
    """
    Send a custom event to the frontend in the specified format.

    Args:
        event_data: CustomUIEventMessageType containing event information
        room: Room object to send event to

    Returns:
        bool: True if event was sent successfully, False otherwise
    """
    try:
        if not event_data.data.show_feedback:
            # Set emoji to null when show_feedback is False
            event_data.data.emoji = None
            event_data.data.message = None

        event_data_bytes = json.dumps(event_data.model_dump()).encode("utf-8")
        await room.local_participant.publish_data(
            event_data_bytes, topic="events", reliable=True
        )

        logger.debug(f"Custom event sent to UI: {event_data.model_dump()}")

        return True

    except Exception as e:
        logger.debug(f"Failed to send custom event to frontend: {type(e).__name__}")
        return False
