"""Conversation event handlers for LiveKit sessions."""
import asyncio
from datetime import datetime
from livekit.agents import ConversationItemAddedEvent
from app.core.events.core_event_sender import CoreEventMessageType
from app.core.events.base import ChatMessage
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

    joined_ts = datetime.fromisoformat(joined_iso.replace('Z', '+00:00')).timestamp()
    return event_timestamp - joined_ts


async def send_event_to_queue(event_data: str) -> None:
    """Safely send event to message queue."""
    try:
        await msg_event_queue.send_message(event_data)
    except Exception as e:
        logger.error(f"Failed to send event to queue: {e}")


def create_conversation_handler(room_id: str, joined_iso: str):
    """
    Factory function to create conversation event handler.

    Args:
        room_id: LiveKit room identifier
        joined_iso: ISO timestamp when agent joined

    Returns:
        Event handler function for conversation_item_added events
    """

    def on_conversation_item_added(event: ConversationItemAddedEvent):
        role = "CLIENT" if event.item.role == "assistant" else "COUNSELOR"
        content = extract_content(event.item)

        chat_message = ChatMessage(
            role=role,
            content=content,
            start_time=calculate_start_time(event.created_at, joined_iso),
            end_time=None
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

    return on_conversation_item_added