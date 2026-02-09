"""Event handlers for LiveKit sessions."""

from __future__ import annotations

import asyncio
import json
from datetime import datetime
from typing import TYPE_CHECKING, Awaitable, Callable, Optional, Set

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator

from livekit import agents, rtc
from livekit.agents import ConversationItemAddedEvent

from app.core.constants import SESSION_TERMINATED_MESSAGE
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.interruption.interruption_event import (
    set_interruption_detected,
)
from app.core.events.schemas import CoreEventMessageType, CustomUIEventMessageType
from app.core.queue import msg_event_queue
from app.utils.logger import get_logger
from app.utils.queue_utils import (
    send_deferred_termination_event,
    send_final_score_to_core,
)

logger = get_logger(__name__)

# Conditional import for interruption detection
try:
    from livekit.agents.voice.io import PlaybackFinishedEvent
except ImportError:
    PlaybackFinishedEvent = None  # type: ignore


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


def create_connection_state_handler(
    event_orchestrator: "EventOrchestrator",
    room_name: str,
    final_score_sent_ref: Callable[[], bool],
    set_final_score_sent: Callable[[bool], None],
    background_tasks: Set[asyncio.Task],
) -> Callable[[rtc.ConnectionState], None]:
    """
    Create a connection state change handler.

    Args:
        event_orchestrator: EventOrchestrator instance
        room_name: Room identifier
        final_score_sent_ref: Callable to get final_score_sent flag
        set_final_score_sent: Callable to set final_score_sent flag
        background_tasks: Set to track background tasks

    Returns:
        Connection state handler function
    """

    def on_connection_state_changed(state: rtc.ConnectionState):
        """Handle connection state changes."""
        logger.info(f"LiveKit Event: Connection state changed: {state}")

        if state == rtc.ConnectionState.CONN_DISCONNECTED:
            if final_score_sent_ref():
                logger.info("Final score already sent, skipping duplicate send")
                return

            logger.info("Connection state is DISCONNECTED, sending final score")

            # End conversation logging if logging is enabled
            try:
                from app.core.config import settings

                if settings.EVALUATION_LOGGING_ENABLED:
                    from app.evaluation.logger import evaluation_logger

                    evaluation_logger.end_conversation(room_name)
            except Exception as e:
                logger.debug(f"Failed to end conversation logging: {e}")

            try:
                task = asyncio.create_task(
                    send_final_score_to_core(
                        room_id=room_name,
                        thread_id=room_name,
                        event_orchestrator=event_orchestrator,
                    )
                )
                background_tasks.add(task)
                task.add_done_callback(background_tasks.discard)
                set_final_score_sent(True)
            except Exception as e:
                logger.error(f"Failed to send final score: {e}")

    return on_connection_state_changed


def setup_interruption_detection(session) -> None:
    """
    Setup LiveKit interruption detection listener.

    Args:
        session: AgentSession instance
    """
    if PlaybackFinishedEvent is None:
        logger.warning(
            "Could not import PlaybackFinishedEvent. "
            "Interruption detection will not work."
        )
        return

    try:

        @session.output.audio.on("playback_finished")
        def on_playback_finished(event: PlaybackFinishedEvent):
            logger.info(
                f"LiveKit playback_finished event received: "
                f"interrupted={event.interrupted}"
            )
            if event.interrupted:
                logger.info(
                    "LiveKit detected interruption: Agent's speech was interrupted"
                )
                # Set the interruption flag for the interruption event to detect
                set_interruption_detected(True)
                logger.info(
                    "Interruption flag set to True - "
                    "InterruptionEvent will detect this in next process_events cycle"
                )
            else:
                # Reset flag when playback finishes normally
                logger.debug(
                    "Playback finished normally (not interrupted) - resetting flag"
                )
                set_interruption_detected(False)

    except Exception as e:
        logger.error(
            f"Failed to set up interruption detection listener: {e}. "
            "Interruption detection will not work."
        )


def create_shutdown_handler(
    event_orchestrator: "EventOrchestrator",
    room_name: str,
    final_score_sent_ref: Callable[[], bool],
    set_final_score_sent: Callable[[bool], None],
    cleanup_background_tasks: Callable[[], None],
) -> Callable[[], None]:
    """
    Create a shutdown callback handler.

    Args:
        event_orchestrator: EventOrchestrator instance
        room_name: Room identifier
        final_score_sent_ref: Callable to get final_score_sent flag
        set_final_score_sent: Callable to set final_score_sent flag
        cleanup_background_tasks: Async function to cleanup background tasks

    Returns:
        Async shutdown handler function
    """

    async def on_shutdown():
        """Cleanup callback when session is shutting down."""
        # Lazy import to avoid circular dependency
        from app.core.events.event_orchestrator.event_orchestrator import (  # noqa: F401, E501
            EventOrchestrator,
        )

        logger.debug("Shutdown callback triggered")

        # End conversation logging if logging is enabled
        try:
            from app.core.config import settings

            if settings.EVALUATION_LOGGING_ENABLED:
                from app.evaluation.logger import evaluation_logger

                evaluation_logger.end_conversation(room_name)
        except Exception as e:
            logger.debug(f"Failed to end conversation logging: {e}")

        # Send deferred termination event
        if event_orchestrator.deferred_termination_event:
            await send_deferred_termination_event(room_name, event_orchestrator)

        # Send final score
        if not final_score_sent_ref():
            try:
                await send_final_score_to_core(
                    room_id=room_name,
                    thread_id=room_name,
                    event_orchestrator=event_orchestrator,
                )
                set_final_score_sent(True)
                logger.info("Final score sent successfully")
            except Exception as e:
                logger.error(f"Failed to send final score: {e}")

        # Cleanup background tasks
        await cleanup_background_tasks()

        logger.info("Shutdown initiated")

    return on_shutdown


# ====================================================================
# Termination Handlers
# ====================================================================


async def handle_termination(
    event: BaseEvent,
    event_orchestrator: "EventOrchestrator",
    session,
    ctx: agents.JobContext,
) -> None:
    """
    Handle session termination when a termination event occurs.

    Args:
        event: Termination event that triggered shutdown
        event_orchestrator: EventOrchestrator instance
        session: AgentSession instance
        ctx: JobContext for shutdown
    """
    # Lazy import to avoid circular dependency
    from app.core.events.event_orchestrator.event_orchestrator import (  # noqa: F401
        EventOrchestrator,
    )

    logger.info(
        f"Termination event '{event.event_id}' triggered. Initiating shutdown..."
    )

    termination_config = event_orchestrator.get_termination_config(event.event_id)
    termination_message = (
        termination_config.termination_message if termination_config else ""
    )
    logger.info(f"Using termination message: {termination_message}")

    # NOTE: This function is only used as a fallback if worker-based termination
    # signaling is not available. Normally, termination is handled in entrypoint
    # context via worker._handle_termination_in_entrypoint_context().
    logger.info("Fallback termination handler - proceeding with shutdown")
    ctx.shutdown(SESSION_TERMINATED_MESSAGE)
    logger.info("Session shutdown completed")


def create_termination_handler(
    session,
    ctx: agents.JobContext,
    background_tasks: Optional[Set[asyncio.Task]] = None,
    worker=None,  # Optional AgentWorker reference for entrypoint-based termination
) -> Callable[[BaseEvent], Awaitable[None]]:
    """
    Create a termination handler that signals entrypoint context for termination.

    This handler needs to be created before EventOrchestrator (which takes it
    as a callback), but the handler needs the orchestrator to get termination
    config. We use a mutable reference pattern to update the orchestrator after
    creation.

    The handler signals the entrypoint context (via worker._termination_event) to
    handle termination audio playback. This allows audio to play reliably because
    it runs in the main async context, not the graph context.

    Args:
        session: AgentSession instance (used in fallback path only)
        ctx: JobContext for shutdown (used in fallback path only)
        background_tasks: Optional set of background tasks (used in fallback path only)
        worker: Optional AgentWorker reference for entrypoint-based termination

    Returns:
        Async termination callback function that can be updated with
        orchestrator reference
    """
    # Mutable reference to store orchestrator (updated after creation)
    orchestrator_ref: list[Optional["EventOrchestrator"]] = [None]

    async def termination_callback(event: BaseEvent) -> None:
        """
        Handle termination event.

        NEW APPROACH: Signal termination to entrypoint context instead of
        handling it directly. This allows audio to play reliably because
        entrypoint runs in main async context, not graph context.
        """
        if orchestrator_ref[0] is None:
            logger.error("EventOrchestrator not set in termination handler")
            return

        logger.info(
            f"Termination callback invoked for event '{event.event_id}'. "
            f"Signaling entrypoint context for termination handling."
        )

        # Get termination message with validation
        termination_config = orchestrator_ref[0].get_termination_config(event.event_id)

        if termination_config is None:
            termination_ids = list(orchestrator_ref[0].termination_event_ids)
            logger.error(
                f"Termination config not found for event '{event.event_id}'. "
                f"Available termination event IDs: {termination_ids}. "
                f"Cannot proceed with termination without a valid config."
            )
            return

        termination_message = termination_config.termination_message

        # Validate termination message is not None and not empty
        if not termination_message or not termination_message.strip():
            logger.error(
                f"Termination message is empty or None for event '{event.event_id}'. "
                f"Termination config: {termination_config}. "
                f"Cannot proceed with termination without a valid message."
            )
            return

        # If worker is provided, signal termination to entrypoint context
        # This allows audio to play reliably (runs in main async context)
        if worker is not None and hasattr(worker, "_termination_event"):
            logger.info(
                f"Signaling termination to entrypoint context with message: "
                f"'{termination_message}'"
            )
            worker._termination_message = termination_message
            worker._termination_event.set()  # Signal entrypoint context
            logger.info("Termination signal sent to entrypoint context")
        else:
            # Fallback: Use old approach if worker not available
            logger.warning(
                "Worker not available - using fallback termination handling "
                "(may not work reliably in graph context)"
            )
            if background_tasks is not None:
                termination_task = asyncio.create_task(
                    handle_termination(
                        event=event,
                        event_orchestrator=orchestrator_ref[0],
                        session=session,
                        ctx=ctx,
                    )
                )
                background_tasks.add(termination_task)
                termination_task.add_done_callback(background_tasks.discard)
            else:
                await handle_termination(
                    event=event,
                    event_orchestrator=orchestrator_ref[0],
                    session=session,
                    ctx=ctx,
                )

    # Add method to update orchestrator reference
    def set_event_orchestrator(event_orchestrator: "EventOrchestrator"):
        """Update the event orchestrator reference."""
        orchestrator_ref[0] = event_orchestrator

    termination_callback.set_event_orchestrator = set_event_orchestrator

    return termination_callback
