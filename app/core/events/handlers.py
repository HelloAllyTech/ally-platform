"""Event handlers for LiveKit sessions."""

from __future__ import annotations

import asyncio
import json
import random
from datetime import datetime
from typing import TYPE_CHECKING, Awaitable, Callable, Optional, Set

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator

from livekit import agents, rtc
from livekit.agents import ConversationItemAddedEvent
from livekit.agents.voice.events import AgentStateChangedEvent, UserStateChangedEvent

from app.core.config import settings
from app.core.constants import SESSION_TERMINATED_MESSAGE
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.interruption.interruption_event import (
    set_interruption_detected,
)
from app.core.events.schemas import (
    CoreEventMessageType,
    CustomUIEventMessageType,
    TurnMetricsData,
)
from app.core.logger import get_logger
from app.core.metrics import turn_metrics
from app.core.queue import msg_event_queue
from app.core.queue.utils import finalize_session, send_deferred_termination_event

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
        logger.info(f"Sent message to Core: {event_data}")
    except Exception as e:
        logger.error(f"Failed to send event to queue: {e}")


def create_conversation_handler(
    room_id: str, joined_iso: str, session=None, scenario=None
):
    """
    Factory function to create conversation event handler with deduplication.

    Tracks speaking start times via agent_state_changed / user_state_changed
    so that transcripts record when audio *started* playing (start_time) and
    when the item was committed to chat history (end_time).

    Args:
        room_id: LiveKit room identifier
        joined_iso: ISO timestamp when agent joined
        session: Optional AgentSession — required to play thinking fillers
            (perceived-latency back-channel). When None, fillers are disabled.
        scenario: Optional Scenario — used to resolve whether fillers are
            enabled and which phrases to use (language-aware).

    Returns:
        Tuple of (conversation_handler, state_handlers, cleanup_function):
        - conversation_handler: Event handler for conversation_item_added events
        - state_handlers: Dict with 'agent_state' and 'user_state' handlers
        - cleanup_function: Function to clean up internal state (call on shutdown)
    """
    seen_utterances = set()

    # Thinking-filler state. _filler_phrases is empty when the feature is off
    # (global kill-switch, scenario opt-out, or no session) — that's the only
    # gate the handlers check. _filler_in_flight marks that a filler's audio is
    # the NEXT agent "speaking" transition, so it can be excluded from
    # response_latency_ms (the filler must not be mistaken for the real reply).
    _filler_phrases: list[str] = []
    _filler_in_flight: list[bool] = [False]
    # Armed when the user finishes a turn (a reply is expected). The filler is
    # played on the agent's next "thinking" transition, then disarmed, so it
    # fires exactly once per reply and never on the agent's opening line.
    _filler_armed: list[bool] = [False]
    if session is not None and scenario is not None:
        try:
            from app.core.livekit.fillers import resolve_filler_phrases

            _filler_phrases = resolve_filler_phrases(scenario)
        except Exception as e:  # noqa: BLE001 - fillers must never break a session
            logger.warning("[FILLER] could not resolve filler phrases: %s", e)
    if _filler_phrases:
        logger.info(
            "[FILLER] enabled for room=%s (%d phrases)", room_id, len(_filler_phrases)
        )

    def _maybe_play_filler() -> None:
        """Play a short back-channel to mask pipeline latency (best-effort).

        Kept out of the transcript (add_to_chat_ctx=False) and interruptible so
        the real reply (or the user resuming) takes over cleanly. Excluded from
        response_latency_ms via _filler_in_flight (see on_agent_state_changed).
        """
        if not _filler_phrases or _filler_in_flight[0]:
            return
        try:
            phrase = random.choice(_filler_phrases)
            session.say(phrase, allow_interruptions=True, add_to_chat_ctx=False)
            _filler_in_flight[0] = True
            logger.info("[FILLER] played phrase=%r room=%s", phrase, room_id)
        except Exception as e:  # noqa: BLE001 - fillers must never break a session
            logger.warning("[FILLER] failed to play filler room=%s: %s", room_id, e)

    # Track when agent/user most recently started speaking.
    # These are consumed (reset to None) when conversation_item_added fires.
    _agent_speaking_start: list[float | None] = [None]
    _user_speaking_start: list[float | None] = [None]

    # Latency tracking: timestamp of the most recent user "stopped speaking"
    # transition. When the agent next transitions to "speaking", we compute the
    # delta and log it as [LATENCY] response_latency_ms — this is the
    # user-perceived response latency that preempt is supposed to reduce.
    _user_speech_end_ts: list[float | None] = [None]

    # ---- turn-metrics emit ----

    def _emit_turn_metrics(room: str, agent_speech_start_ts: float) -> None:
        """Finalize the in-flight turn and ship its metrics to Core.

        Best-effort and fire-and-forget: builds the record from the accumulated
        component timings, stamps the env dimension, and schedules the SQS send
        so the (sync) state handler never blocks on the network.
        """
        try:
            rec = turn_metrics.finalize(room, agent_speech_start_ts)
            if not rec:
                return
            rec.setdefault("env", settings.ENV.value)
            message = CoreEventMessageType.create_turn_metrics(
                room, TurnMetricsData(**rec)
            )
            asyncio.create_task(send_event_to_queue(message.model_dump_json()))
        except Exception:  # noqa: BLE001 - metrics must never break a turn
            logger.exception("[turn-metrics] emit failed for room=%s", room)

    # ---- state-change handlers ----

    def on_agent_state_changed(event: AgentStateChangedEvent):
        if event.new_state == "thinking":
            # The agent has committed to generating a reply — the canonical,
            # pipeline-aligned moment to mask the gap, with the most lead time
            # before the reply's audio. Fired here (not on user-stop) because the
            # user-stop trigger raced LiveKit's turn pipeline and got preempted
            # on normal turns. Armed only by a preceding user turn, so it never
            # fires on the opening line and fires once per reply.
            if _filler_armed[0]:
                _filler_armed[0] = False
                _maybe_play_filler()
            return
        if event.new_state == "speaking":
            # The thinking-filler also makes the agent enter "speaking". Do NOT
            # treat it as the real reply: skip latency + transcript bookkeeping
            # for this transition and clear the flag. The real reply is the next
            # "speaking" transition, which is measured normally. This keeps
            # response_latency_ms tracking true pipeline latency, not the filler.
            if _filler_in_flight[0]:
                _filler_in_flight[0] = False
                logger.info(
                    "[FILLER] filler speaking (excluded from response_latency) "
                    "room=%s ts=%.3f",
                    room_id,
                    event.created_at,
                )
                return
            _agent_speaking_start[0] = event.created_at
            logger.debug(f"Agent started speaking at {event.created_at}")
            # Compute response latency if we have a matching user_speech_end
            user_end = _user_speech_end_ts[0]
            if user_end is not None:
                latency_ms = (event.created_at - user_end) * 1000
                logger.info(
                    "[LATENCY] response_latency_ms=%.1f room=%s "
                    "user_speech_end=%.3f agent_speech_start=%.3f",
                    latency_ms,
                    room_id,
                    user_end,
                    event.created_at,
                )
                _user_speech_end_ts[0] = None  # consume
                # Persist the turn's latency (total + accumulated breakdown) to
                # Core for the Metabase dashboards. Best-effort: never let a
                # metrics failure disrupt the conversation.
                _emit_turn_metrics(room_id, event.created_at)
            else:
                logger.info(
                    "[LATENCY] agent_speech_start room=%s ts=%.3f "
                    "(no matching user_speech_end)",
                    room_id,
                    event.created_at,
                )

    def on_user_state_changed(event: UserStateChangedEvent):
        if event.new_state == "speaking":
            _user_speaking_start[0] = event.created_at
            # User (re)started speaking — cancel any pending filler accounting so
            # a filler that never reached playout doesn't skip the next real
            # reply's latency measurement, and disarm the filler.
            _filler_in_flight[0] = False
            _filler_armed[0] = False
            logger.debug(f"User started speaking at {event.created_at}")
        else:
            # User left "speaking" — endpointing fired (or interim ended).
            # Stash this as the start of the latency measurement window.
            _user_speech_end_ts[0] = event.created_at
            logger.info(
                "[LATENCY] user_speech_end room=%s new_state=%s ts=%.3f",
                room_id,
                event.new_state,
                event.created_at,
            )
            # Begin a turn in the metrics accumulator; graph nodes + LiveKit
            # metrics will record component timings into it before finalize.
            try:
                turn_metrics.note_user_speech_end(room_id, event.created_at)
            except Exception:  # noqa: BLE001 - metrics must never break a turn
                logger.exception("[turn-metrics] note_user_speech_end failed")
            # Arm the filler: it plays on the agent's next "thinking" transition
            # (the reply pipeline), not here — see on_agent_state_changed.
            _filler_armed[0] = True

    # ---- main conversation handler ----

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

        # Determine start_time (when audio began) and end_time (when committed)
        # For agent (assistant/CLIENT): use tracked agent speaking start
        # For user (COUNSELOR): use tracked user speaking start
        if event.item.role == "assistant":
            speaking_start = _agent_speaking_start[0]
            _agent_speaking_start[0] = None  # consume
        else:
            speaking_start = _user_speaking_start[0]
            _user_speaking_start[0] = None  # consume

        # start_time: relative seconds from conversation start when audio began
        # (speaking_start).
        # end_time: relative seconds from conversation start when the item was
        # committed (event.created_at).
        # speaking_start is set by on_agent_state_changed / on_user_state_changed
        # and consumed here to ensure each utterance uses the correct
        # corresponding speaking window.
        start_time = (
            calculate_start_time(speaking_start, joined_iso) if speaking_start else None
        )
        end_time = calculate_start_time(event.created_at, joined_iso)

        # Fallback: speaking_start may be None if the state-change event was missed
        # (e.g. handler not yet registered, or event fired before the agent joined).
        # In that case, use end_time so that start_time is never left undefined.
        if start_time is None:
            logger.debug(
                f"No speaking start captured for {role}, "
                f"falling back to end_time as start_time"
            )
            start_time = end_time

        chat_message = ChatMessage(
            role=role,
            content=content,
            start_time=start_time,
            end_time=end_time,
        )

        logger.debug(
            f"Transcript [{role}]: start_time={start_time:.2f}s, "
            f"end_time={end_time:.2f}s, content={content[:20]}"
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
        _agent_speaking_start[0] = None
        _user_speaking_start[0] = None
        logger.debug(f"Cleaned up {count} utterance entries from conversation handler")

    state_handlers = {
        "agent_state": on_agent_state_changed,
        "user_state": on_user_state_changed,
    }

    return on_conversation_item_added, state_handlers, cleanup


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
    score_keeper=None,
) -> Callable[[rtc.ConnectionState], None]:
    """
    Create a connection state change handler.

    Args:
        event_orchestrator: EventOrchestrator instance
        room_name: Room identifier
        final_score_sent_ref: Callable to get final_score_sent flag
        set_final_score_sent: Callable to set final_score_sent flag
        background_tasks: Set to track background tasks
        score_keeper: Optional ScoreKeeper instance for behavior scores

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
                    finalize_session(
                        room_id=room_name,
                        thread_id=room_name,
                        event_orchestrator=event_orchestrator,
                        score_keeper=score_keeper,
                    )
                )
                background_tasks.add(task)
                task.add_done_callback(background_tasks.discard)
                set_final_score_sent(True)
            except Exception as e:
                logger.exception(f"Failed to finalize session: {e}")

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
            logger.debug(
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
    score_keeper=None,
) -> Callable[[], None]:
    """
    Create a shutdown callback handler.

    Args:
        event_orchestrator: EventOrchestrator instance
        room_name: Room identifier
        final_score_sent_ref: Callable to get final_score_sent flag
        set_final_score_sent: Callable to set final_score_sent flag
        cleanup_background_tasks: Async function to cleanup background tasks
        score_keeper: Optional ScoreKeeper instance for behavior scores

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

        # Finalize session (send final score and cleanup)
        if not final_score_sent_ref():
            try:
                await finalize_session(
                    room_id=room_name,
                    thread_id=room_name,
                    event_orchestrator=event_orchestrator,
                    score_keeper=score_keeper,
                )
                set_final_score_sent(True)
                logger.info("Session finalized successfully")
            except Exception as e:
                logger.exception(f"Failed to finalize session: {e}")

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
