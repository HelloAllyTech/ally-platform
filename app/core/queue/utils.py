"""Queue messaging utilities for session management and backend communication."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator

from app.core.events.schemas import CoreEventMessageType
from app.core.events.utils import get_current_score_from_graph
from app.core.graph.utils import serialize_event
from app.core.logger import get_logger
from app.core.queue import msg_event_queue

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
        room_id=room_id, event_data={"id": "end-of-session", "totalScore": final_score}
    )


async def send_final_score_to_core(
    room_id: str, thread_id: str, event_orchestrator=None
) -> None:
    """
    Send final score to backend queue for session end or disconnect.

    This provides the backend with the source of truth for the final score.
    Not an event in the event system - just a session management indication.

    Args:
        room_id: LiveKit room identifier
        thread_id: LangGraph thread identifier (usually same as room_id)
        event_orchestrator: Optional EventOrchestrator instance to get
            live_score from.
            If provided, uses live_score. Otherwise falls back to graph
            state.
    """
    try:
        # Get the final score from event_orchestrator.live_score if available,
        # otherwise fall back to graph state
        if event_orchestrator is not None:
            final_score = event_orchestrator.live_score
            logger.info(f"Using live_score from event_orchestrator: {final_score}")
        else:
            final_score = get_current_score_from_graph(thread_id)
            logger.warning(
                "event_orchestrator not provided, falling back to graph " "state score"
            )

        # Create the session end message
        core_message = create_session_end_message(room_id, final_score)

        # Send to queue
        logger.info(
            f"Sending end-of-session message {core_message} with final "
            f"score {final_score} to backend"
        )
        await send_message_to_queue(core_message.model_dump_json())

    except Exception as e:
        logger.error(f"Failed to send end-of-session message to backend: {e}")


async def send_deferred_termination_event(
    room_id: str, event_orchestrator: "EventOrchestrator"
) -> None:
    """
    Send deferred termination event to Core.

    Termination events are deferred to ensure the agent completes speaking
    the termination message before the backend receives autoTerminationStatus=true.

    Args:
        room_id: LiveKit room identifier
        event_orchestrator: EventOrchestrator instance
    """
    # Lazy import to avoid circular dependency
    from app.core.events.event_orchestrator.event_orchestrator import (  # noqa: F401
        EventOrchestrator,
    )

    try:
        deferred_event = event_orchestrator.deferred_termination_event
        if not deferred_event:
            return

        termination_config = event_orchestrator.get_termination_config(
            deferred_event.event_id
        )
        termination_event_id = termination_config.id if termination_config else None
        termination_message = (
            termination_config.termination_message if termination_config else None
        )

        event_dict = serialize_event(
            deferred_event,
            termination_event_id=termination_event_id,
            termination_message=termination_message,
        )
        core_event_message = CoreEventMessageType.create(
            room_id=room_id, event_data=event_dict
        )
        await msg_event_queue.send_message(
            message_body=core_event_message.model_dump_json()
        )
        logger.info("Deferred termination event sent to Core")
    except Exception as e:
        logger.error(f"Failed to send deferred termination event: {e}")
