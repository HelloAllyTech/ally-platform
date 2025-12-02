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


def create_session_end_message(room_id: str, final_score: int,
                               message_type: str = "session_end") -> CoreEventMessageType:
    """
    Create a session end message with total score for backend.

    This is not an event in the event system - it's a backend indication
    that provides the source of truth for the final score at the end of a call.

    Args:
        room_id: LiveKit room identifier
        final_score: Final total score for the session
        message_type: Type of message (e.g., "session_end", "participant_disconnect")

    Returns:
        CoreEventMessageType ready to be sent to queue
    """
    return CoreEventMessageType.create(
        room_id=room_id,
        event_data={
            "type": message_type,
            "final_score": final_score,
            "message": f"Session ending with total score: {final_score}"
        }
    )


async def send_final_score_to_core(room_id: str, thread_id: str, message_type: str = "session_end") -> None:
    """
    Send final score to backend queue for session end or disconnect.

    This provides the backend with the source of truth for the final score.
    Not an event in the event system - just a session management indication.

    Args:
        room_id: LiveKit room identifier
        thread_id: LangGraph thread identifier (usually same as room_id)
        message_type: Type of message (e.g., "session_end", "participant_disconnect")
    """
    try:
        # Get the final score from the graph state
        final_score = get_current_score_from_graph(thread_id)

        # Create the session end message
        core_message = create_session_end_message(room_id, final_score, message_type)

        # Send to queue
        logger.info(f"Sending {message_type} message with final score: {final_score} to backend")
        await send_message_to_queue(core_message.model_dump_json())

    except Exception as e:
        logger.error(f"Failed to send {message_type} message to backend: {e}")