"""Queue messaging utilities for session management and backend communication."""
from app.core.events.schemas import CoreEventMessageType
from app.core.queue import msg_event_queue
from app.utils.event_utils import get_current_score_from_graph
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def send_message_to_queue(message_data: str) -> None:
    """
    Safely send message to message queue.

    Args:
        message_data: JSON string message to send
    """
    try:
        await msg_event_queue.send_message(message_data)
    except Exception as e:
        logger.error(f"Failed to send message to queue: {e}")


def create_session_end_message(room_id: str, final_score: int) -> CoreEventMessageType:
    """
    Create a session end message with total score for backend.

    This is not an event in the event system - it's a backend indication
    that provides the source of truth for the final score at the end of a call.

    Args:
        room_id: LiveKit room identifier
        final_score: Final total score for the session

    Returns:
        CoreEventMessageType ready to be sent to queue
    """
    return CoreEventMessageType.create(
        room_id=room_id,
        event_data={
            "id": "end-of-session",
            "totalScore": final_score
        }
    )


async def send_final_score_to_core(room_id: str, thread_id: str, event_registry=None) -> None:
    """
    Send final score to backend queue for session end or disconnect.

    This provides the backend with the source of truth for the final score.
    Not an event in the event system - just a session management indication.

    Args:
        room_id: LiveKit room identifier
        thread_id: LangGraph thread identifier (usually same as room_id)
        event_registry: Optional EventRegistry instance to get live_score from.
                       If provided, uses live_score. Otherwise falls back to graph state.
    """
    try:
        # Get the final score from event_registry.live_score if available,
        # otherwise fall back to graph state
        if event_registry is not None:
            final_score = event_registry.live_score
            logger.info(f"Using live_score from event_registry: {final_score}")
        else:
            final_score = get_current_score_from_graph(thread_id)
            logger.warning("event_registry not provided, falling back to graph state score")

        # Create the session end message
        core_message = create_session_end_message(room_id, final_score)

        # Send to queue
        logger.info(f"Sending end-of-session message {core_message} with final score {final_score} to backend")
        await send_message_to_queue(core_message.model_dump_json())

    except Exception as e:
        logger.error(f"Failed to send end-of-session message to backend: {e}")