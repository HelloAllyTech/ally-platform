"""Event handlers for LiveKit sessions."""

from __future__ import annotations

import asyncio
import json
from collections import deque
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
from app.core.tasks import spawn_background_task

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
    room_id: str,
    joined_iso: str,
    background_tasks: Optional[Set[asyncio.Task]] = None,
):
    """
    Factory function to create conversation event handler with deduplication.

    Tracks speaking start times via agent_state_changed / user_state_changed
    so that transcripts record when audio *started* playing (start_time) and
    when the item was committed to chat history (end_time).

    Args:
        room_id: LiveKit room identifier
        joined_iso: ISO timestamp when agent joined
        background_tasks: Optional set to hold strong references to the
            fire-and-forget transcript/metrics send tasks scheduled below.
            asyncio only holds a weak reference to a task, so an untracked
            task can be garbage-collected mid-send — dropping the message
            with an unawaited "Task was destroyed but it is pending!"
            warning instead of an error. Same convention as the worker's own
            `self._background_tasks` (app/worker.py) and
            `EventOrchestrator._background_tasks`.

    Returns:
        Tuple of (conversation_handler, state_handlers, cleanup_function):
        - conversation_handler: Event handler for conversation_item_added events
        - state_handlers: Dict with 'agent_state' and 'user_state' handlers
        - cleanup_function: Function to clean up internal state (call on shutdown)

    Note: the thinking-filler is NOT here. It plays on a separate audio track via
    BackgroundAudioPlayer (set up in the worker) so it can't race the reply; see
    app/core/livekit/opener_player.py.
    """
    # Bounded de-dup of utterances. A failed transcript publish retries within
    # seconds, so a recent-window cap preserves dedup behavior exactly while
    # keeping memory O(1) in call length — previously this set grew unbounded,
    # holding the whole conversation's text in RAM until shutdown. The key is
    # kept identical ((content, created_at)); only the size is bounded.
    _SEEN_UTTERANCES_MAX = 512
    seen_utterances: set = set()
    seen_utterances_order: deque = deque()

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
            spawn_background_task(
                send_event_to_queue(message.model_dump_json()),
                name="turn-metrics-send",
                background_tasks=background_tasks,
            )
        except Exception:  # noqa: BLE001 - metrics must never break a turn
            logger.exception("[turn-metrics] emit failed for room=%s", room)

    # ---- state-change handlers ----

    def on_agent_state_changed(event: AgentStateChangedEvent):
        if event.new_state == "speaking":
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
            logger.debug(f"User started speaking at {event.created_at}")
        elif getattr(event, "old_state", "speaking") != "speaking":
            # NOT a speech end. UserState is speaking|listening|away, so this
            # branch also catches listening->away (LiveKit's user_away_timeout,
            # 15s by default and unset by us) and away->listening when the
            # learner comes back. Treating those as "the learner just stopped
            # talking" restarted the latency window mid-turn and understated
            # response_latency_ms by up to that timeout — worst on exactly the
            # turns where the agent never reached "thinking" (a dropped turn, or
            # the silently-deaf STT failure), which are the slow turns the
            # latency analytics exist to find.
            logger.debug(
                "[LATENCY] ignoring non-speech-end user_state transition "
                "%s->%s room=%s",
                getattr(event, "old_state", None),
                event.new_state,
                room_id,
            )
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

    # ---- main conversation handler ----

    def on_conversation_item_added(event: ConversationItemAddedEvent):
        try:
            _on_conversation_item_added(event)
        except Exception:  # noqa: BLE001
            # LiveKit's EventEmitter re-raises TypeError (unlike every other
            # exception, which it logs and swallows), so letting one escape
            # here propagates out of session.emit("conversation_item_added",
            # ...) and can kill whichever internal task drives that event for
            # the rest of the session — silently stopping the transcript feed
            # mid-session while audio/turn-taking carry on unaffected.
            logger.exception(
                "conversation_item_added handler failed for room=%s", room_id
            )

    def _on_conversation_item_added(event: ConversationItemAddedEvent):
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
        seen_utterances_order.append(utterance_key)
        if len(seen_utterances_order) > _SEEN_UTTERANCES_MAX:
            seen_utterances.discard(seen_utterances_order.popleft())

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

        # LiveKit sets `interrupted` on the assistant ChatMessage it emits, and
        # `content` is the text that actually reached TTS before the utterance
        # stopped — so on an interrupted turn the transcript is a PREFIX of what
        # the model generated. Carrying the flag lets the judge stop reading that
        # prefix as the actor failing to finish a sentence: measured, a cut turn
        # keeps ~36% of the generated characters against ~107% on an uncut one,
        # and `truncation` is the second-largest annotation category because of
        # it. Read defensively — the attribute is absent on older LiveKit
        # versions and meaningless on a COUNSELOR turn.
        interrupted = (
            bool(getattr(event.item, "interrupted", False))
            if event.item.role == "assistant"
            else None
        )

        chat_message = ChatMessage(
            role=role,
            content=content,
            start_time=start_time,
            end_time=end_time,
            interrupted=interrupted,
            # This handler only ever carries the REAL generated reply: the
            # filler and the interim are published by the worker directly (they
            # never pass through the AgentSession's conversation items). Marking
            # it is what lets a consumer tell the three apart — they are all
            # CLIENT lines, and one turn can emit all three in a row.
            utterance_kind="reply" if role == "CLIENT" else None,
        )

        start_time_str = "None" if start_time is None else f"{start_time:.2f}"
        end_time_str = "None" if end_time is None else f"{end_time:.2f}"
        logger.debug(
            f"Transcript [{role}]: start_time={start_time_str}s, "
            f"end_time={end_time_str}s, content={content[:20]}"
        )

        core_event = CoreEventMessageType.create(
            room_id=room_id,
            chat_message=chat_message,
        )

        logger.debug(f"Enqueuing {role} message to SQS")

        # Schedule async send without blocking. There used to be a
        # get_event_loop() fallback here for "contexts without a running
        # loop": it abandoned the first coroutine (RuntimeWarning, message
        # lost) and then queued the second one onto a loop nobody runs, so it
        # never sent either. LiveKit invokes this handler from the loop, so
        # the no-loop case is a real failure — log it, don't fake a send.
        spawn_background_task(
            send_event_to_queue(core_event.model_dump_json()),
            name="transcript-send",
            background_tasks=background_tasks,
        )

    def cleanup():
        """Clean up the seen_utterances set."""
        count = len(seen_utterances)
        seen_utterances.clear()
        seen_utterances_order.clear()
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
    llm_client=None,
    language_code=None,
    prompt_data=None,
    rolling_summary_store=None,
    client_working_memory_store=None,
    finalize_task_ref: Optional[list] = None,
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
        llm_client / language_code / prompt_data: forwarded to
            finalize_session for the session-memory emission (all optional)

    Returns:
        Connection state handler function
    """

    def on_connection_state_changed(state: rtc.ConnectionState):
        """Handle connection state changes."""
        logger.info(f"LiveKit Event: Connection state changed: {state}")

        # A transient drop the SDK is actively retrying. Explicitly NOT treated
        # as the end of the session: finalizing here would ship a final score
        # for a session that is about to resume. It is called out at WARNING so
        # "the learner heard nothing for 20s" is attributable in the logs
        # instead of being invisible. The learner-facing signal and the
        # stall-watchdog suspension live in the worker, which owns both — see
        # AgentWorker._handle_reconnection_state.
        _reconnecting = getattr(rtc.ConnectionState, "CONN_RECONNECTING", None)
        if _reconnecting is not None and state == _reconnecting:
            logger.warning(
                "LiveKit connection RECONNECTING (room=%s) — SDK is retrying; "
                "not finalizing, the session may still recover",
                room_name,
            )
            return

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
                        llm_client=llm_client,
                        language_code=language_code,
                        prompt_data=prompt_data,
                        rolling_summary_store=rolling_summary_store,
                        client_working_memory_store=client_working_memory_store,
                    )
                )
                background_tasks.add(task)
                task.add_done_callback(background_tasks.discard)
                if finalize_task_ref is not None:
                    finalize_task_ref[:] = [task]
                set_final_score_sent(True)
            except Exception as e:
                logger.exception(f"Failed to finalize session: {e}")

    return on_connection_state_changed


def setup_interruption_detection(session, room_id: Optional[str] = None) -> None:
    """
    Setup LiveKit interruption detection listener.

    Besides arming the scenario-event flag, this records the barge-in onto the
    turn-metrics record so interruption rate is measurable platform-wide rather
    than only in scenarios that happen to configure a HELPER_INTERRUPTED event.

    SEMANTICS OF ``interrupted``, which are easy to get wrong:

    A turn's metrics record is finalized and shipped when the agent STARTS
    speaking, but LiveKit only reports the interruption when playback FINISHES —
    by which time that turn's record is already gone. So ``interrupted`` cannot
    mean "the agent's reply on this row was cut short".

    What it does mean: **this turn was produced by the learner cutting the agent
    off**. The barge-in utterance is the start of the next turn, so ``record``
    lands on the in-flight turn — the one the learner's interrupting speech goes
    on to produce. That is a coherent barge-in rate and needs no change to the
    emit path; it is simply not the same statement as "this reply was truncated".

    Args:
        session: AgentSession instance
        room_id: room to attribute the barge-in to. Omitted in tests and older
            call sites, in which case only the scenario-event flag is set —
            never guessed, because attributing a barge-in to the wrong room
            would corrupt another session's metrics.
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
                # Attribute the barge-in to the turn the learner is currently
                # producing. `record` lazily creates the in-flight turn, so this
                # works whether or not endpointing has fired yet.
                if room_id:
                    try:
                        turn_metrics.record(room_id, interrupted=True)
                    except Exception:  # noqa: BLE001 - metrics never break a turn
                        logger.exception(
                            "[turn-metrics] failed to record barge-in room=%s",
                            room_id,
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
    llm_client=None,
    language_code=None,
    prompt_data=None,
    rolling_summary_store=None,
    client_working_memory_store=None,
    finalize_task_ref: Optional[list] = None,
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
        llm_client / language_code / prompt_data: forwarded to
            finalize_session for the session-memory emission (all optional)

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

        # Drain in-flight off-gate background sends (EVENTS_OFF_GATE /
        # ORCHESTRATION_ASYNC_SQS) before finalizing, so the last turn's
        # non-branching backend rows are not dropped on shutdown. The
        # orchestrator keeps its OWN _background_tasks set, separate from the
        # worker's cleanup_background_tasks (which cancels), so it must be drained
        # explicitly here. Drain (do NOT cancel) under a short timeout so finalize
        # still proceeds promptly.
        pending_sends = [
            t for t in list(event_orchestrator._background_tasks) if not t.done()
        ]
        if pending_sends:
            logger.info(
                "Draining %d in-flight orchestrator background task(s) before "
                "finalize",
                len(pending_sends),
            )
            try:
                await asyncio.wait_for(
                    asyncio.gather(*pending_sends, return_exceptions=True),
                    timeout=3.0,
                )
            except asyncio.TimeoutError:
                logger.warning(
                    "Orchestrator background drain timed out after 3s; "
                    "proceeding to finalize"
                )

        # Non-gating combinations fire on the gate pass AFTER their deferred
        # inputs land; the last turn has none, so evaluate them once more now
        # that the drain above has marked the last deferred inputs.
        try:
            await asyncio.wait_for(
                event_orchestrator.evaluate_deferred_combinations(
                    getattr(event_orchestrator, "room", None)
                ),
                timeout=3.0,
            )
        except Exception as e:  # noqa: BLE001 - never block finalize on this
            logger.warning("Final deferred-combination pass failed: %s", e)

        # Finalize session (send final score and cleanup)
        if not final_score_sent_ref():
            try:
                # Same budget as the in-flight-task drain below: one full
                # compaction attempt (ROLLING_SUMMARY_TIMEOUT, 8s) + the 6s
                # retry inside finalize_session, with headroom. Without this
                # cap, finalize_session's uncapped SQS/LLM time stacked on
                # top of the 3s orchestrator drain above could push
                # on_shutdown past the SDK's shutdown_process_timeout,
                # triggering a forced SIGUSR1 kill mid-finalize (observed
                # live: supervised_proc.py "did not exit in time" followed by
                # exit code -10). Shielded so our timeout can't cancel a
                # healthy finalize that is merely running long.
                await asyncio.wait_for(
                    asyncio.shield(
                        finalize_session(
                            room_id=room_name,
                            thread_id=room_name,
                            event_orchestrator=event_orchestrator,
                            score_keeper=score_keeper,
                            llm_client=llm_client,
                            language_code=language_code,
                            prompt_data=prompt_data,
                            rolling_summary_store=rolling_summary_store,
                            client_working_memory_store=client_working_memory_store,
                        )
                    ),
                    timeout=16.0,
                )
                set_final_score_sent(True)
                logger.info("Session finalized successfully")
            except asyncio.TimeoutError:
                logger.warning(
                    "finalize_session did not finish within 16s; final "
                    "score or session memory may be lost for this session"
                )
            except Exception as e:
                logger.exception(f"Failed to finalize session: {e}")

        # Drain the in-flight finalize task (spawned by the connection-state
        # handler on disconnect) BEFORE cleanup cancels background tasks. For
        # short sessions (no maintained summary yet) the phase-2 final
        # compaction inside finalize is the ONLY source of session memory,
        # and it needs a few seconds of LLM time the old path never granted
        # (observed live: the task died inside wait_for, CancelledError
        # skipped every log). The room is already gone — holding the job
        # process briefly is free; LiveKit's drain budget is far larger.
        # Cap above ROLLING_SUMMARY_TIMEOUT so a healthy compaction always
        # fits; shield so OUR timeout doesn't cancel it (cleanup will, if it
        # is truly stuck).
        pending_finalize = finalize_task_ref[0] if finalize_task_ref else None
        if pending_finalize is not None and not pending_finalize.done():
            logger.info("Draining in-flight finalize task before cleanup")
            try:
                # Budget: one full compaction attempt (ROLLING_SUMMARY_TIMEOUT,
                # 8s) + the 6s retry in finalize_session, with headroom.
                await asyncio.wait_for(asyncio.shield(pending_finalize), timeout=16.0)
            except asyncio.TimeoutError:
                logger.warning(
                    "Finalize task did not finish within 16s; "
                    "session memory may be lost for this session"
                )
            except Exception:  # noqa: BLE001 - drain must never break shutdown
                pass

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
