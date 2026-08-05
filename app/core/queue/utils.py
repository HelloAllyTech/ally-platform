"""Queue messaging utilities for session management and backend communication."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator

from app.core.events.schemas import CoreEventMessageType, SessionMemoryData
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


async def send_session_paused_message(room_id: str, at_ms: int) -> None:
    """Tell Core a session was paused so it can freeze the duration clock.

    Args:
        room_id: LiveKit room identifier.
        at_ms: Epoch-millisecond timestamp when the pause began.
    """
    message = CoreEventMessageType.create(
        room_id=room_id, event_data={"id": "session-paused", "atMs": at_ms}
    )
    logger.info("Sending session-paused for room=%s at_ms=%s", room_id, at_ms)
    await send_message_to_queue(message.model_dump_json())


async def send_session_resumed_message(
    room_id: str, at_ms: int, total_paused_ms: int
) -> None:
    """Tell Core a session resumed, carrying the authoritative cumulative
    paused duration so billing/limits exclude paused time.

    ``total_paused_ms`` is the agent's cumulative paused milliseconds (from the
    SessionClock) — used as the source of truth so a lost/duplicate event cannot
    corrupt the total.

    Args:
        room_id: LiveKit room identifier.
        at_ms: Epoch-millisecond timestamp when the session resumed.
        total_paused_ms: Cumulative paused milliseconds so far.
    """
    message = CoreEventMessageType.create(
        room_id=room_id,
        event_data={
            "id": "session-resumed",
            "atMs": at_ms,
            "totalPausedMs": total_paused_ms,
        },
    )
    logger.info(
        "Sending session-resumed for room=%s total_paused_ms=%s",
        room_id,
        total_paused_ms,
    )
    await send_message_to_queue(message.model_dump_json())


async def _emit_session_memory(
    room_id: str,
    thread_id: str,
    llm_client=None,
    language_code: str | None = None,
    prompt_data=None,
    rolling_summary_store=None,
) -> None:
    """Ship the session's episodic memory (rolling summary) to Core.

    Runs once, inside finalize_session, BEFORE checkpoint cleanup. The
    worker-owned RollingSummaryStore is the source of truth — graph state is
    only a best-effort source for the not-yet-summarized TAIL messages, so a
    final compaction can fold them in. Graph state can legitimately be
    unreadable here (ending a session mid-turn cancels the in-flight run and
    the PruningCheckpointer keeps a single checkpoint), in which case the last
    maintained summary is sent as-is. Sessions too short to have produced any
    summary send nothing — Core keeps its existing previousMemory behavior
    for those.
    """
    import asyncio

    from app.core.config import settings

    if not settings.ROLLING_SUMMARY_ENABLED:
        logger.debug("session_memory skipped: ROLLING_SUMMARY_ENABLED is off")
        return

    async def _send(summary_text: str, message_count: int, covered: int) -> None:
        memory = SessionMemoryData(
            summary=summary_text,
            language=language_code,
            message_count=message_count,
            summarized_message_count=covered,
        )
        message = CoreEventMessageType.create_session_memory(
            room_id=room_id, session_memory=memory
        )
        logger.info(
            "Sending session_memory for room=%s (summary_chars=%d, coverage=%d/%d)",
            room_id,
            len(memory.summary),
            memory.summarized_message_count,
            memory.message_count,
        )
        await send_message_to_queue(message.model_dump_json())

    store = rolling_summary_store
    maintained = (store.summary or "").strip() if store is not None else ""
    covered_count = max(0, store.covered_count) if store is not None else 0

    # Best-effort read of the full message list for the final compaction.
    messages = []
    try:
        from app.core.graph import agent_graph

        state = agent_graph.get_state({"configurable": {"thread_id": thread_id}})
        values = state.values if state and state.values else {}
        messages = values.get("messages") or []
    except Exception as state_error:
        logger.warning(
            "Could not read graph state for final compaction (%s); "
            "using the maintained summary as-is",
            state_error,
        )

    message_count = max(len(messages), store.total_count if store is not None else 0)

    # PHASE 1 — ship the maintained summary IMMEDIATELY (pure SQS send,
    # milliseconds). The disconnect path gives this task almost no runway:
    # the worker's shutdown cancels background tasks and the job process
    # exits within ~2s, which killed the emission entirely when it waited on
    # a final-compaction LLM call first (observed live: the finalize task
    # died inside wait_for and CancelledError skipped every log). Delivering
    # the last good summary must never depend on another LLM round-trip.
    if maintained:
        await _send(maintained, message_count, covered_count)

    # PHASE 2 — best-effort upgrade: fold the not-yet-covered tail in and
    # send a message with higher coverage. Core's processor keeps whichever
    # write covers more messages, so a cancelled/never-delivered upgrade (or
    # out-of-order delivery) can't clobber phase 1. This is also what gives
    # SHORT sessions (< one compaction cycle, no maintained summary) a
    # memory at all — when the runway allows it.
    if llm_client is not None and messages and covered_count < len(messages):
        from app.core.graph.rolling_summary import update_rolling_summary

        try:
            upgraded = await asyncio.wait_for(
                update_rolling_summary(
                    previous_summary=maintained or None,
                    new_messages=messages[covered_count:],
                    llm_client=llm_client,
                    prompt_data=prompt_data,
                ),
                timeout=settings.ROLLING_SUMMARY_TIMEOUT,
            )
        except Exception as e:
            logger.warning(
                "Final session-memory compaction failed (%s); %s",
                e,
                (
                    f"phase-1 summary covering {covered_count}/{message_count} "
                    "messages already sent"
                    if maintained
                    else "no summary was available to send"
                ),
            )
            return
        upgraded = (upgraded or "").strip()
        if upgraded and upgraded != maintained:
            await _send(upgraded, len(messages), len(messages))
    elif not maintained:
        logger.info(
            "No rolling summary available for room=%s; skipping session_memory",
            room_id,
        )


async def finalize_session(
    room_id: str,
    thread_id: str,
    event_orchestrator=None,
    score_keeper=None,
    llm_client=None,
    language_code: str | None = None,
    prompt_data=None,
    rolling_summary_store=None,
) -> None:
    """
    Finalize a session by sending final score and cleaning up resources.

    This function performs session cleanup tasks:
    1. Sends final score to backend queue
    2. Ships the episodic-memory summary (session_memory) to backend
    3. Cleans up checkpoint data to prevent memory leaks

    ScoreKeeper is the single source of truth: it holds both event scores
    (committed by EventOrchestrator) and behavior scores (committed by
    detect_behaviors). Falls back to LangGraph state only when ScoreKeeper
    is absent (e.g. legacy callers or tests).

    Args:
        room_id: LiveKit room identifier
        thread_id: LangGraph thread identifier (usually same as room_id)
        event_orchestrator: Kept for backward-compatible call sites; unused
            now that EventOrchestrator writes into ScoreKeeper directly.
        score_keeper: ScoreKeeper instance. When present, its get_total_score()
            is the definitive final score.
        llm_client: Main-agent LLM client, used for the final session-memory
            compaction. Optional — without it the last maintained summary is
            sent uncompacted.
        language_code: Session BCP-47 code, stamped on the session_memory
            message.
        prompt_data: Scenario PromptData for summarizer template resolution
            (dashboard override support). Optional.
        rolling_summary_store: Worker-owned RollingSummaryStore holding the
            maintained summary (source of truth for the session_memory
            message). Optional.
    """
    try:
        if score_keeper is not None:
            final_score = score_keeper.get_total_score()
            logger.info(
                f"Final score from ScoreKeeper — events: {score_keeper.event_score}, "
                f"behaviors: {score_keeper.behavior_score}, total: {final_score}"
            )
        else:
            final_score = get_current_score_from_graph(thread_id)
            logger.warning(
                "ScoreKeeper not provided, falling back to graph state score"
            )

        # Create the session end message
        core_message = create_session_end_message(room_id, final_score)

        logger.info(
            f"Sending end-of-session message {core_message} with final "
            f"score {final_score} to backend"
        )
        await send_message_to_queue(core_message.model_dump_json())

        # Episodic memory: must run BEFORE checkpoint cleanup below — the
        # rolling summary lives in the LangGraph checkpoint. Never blocks
        # finalize on failure.
        try:
            await _emit_session_memory(
                room_id=room_id,
                thread_id=thread_id,
                llm_client=llm_client,
                language_code=language_code,
                prompt_data=prompt_data,
                rolling_summary_store=rolling_summary_store,
            )
        except Exception as memory_error:
            logger.error(f"Failed to emit session memory: {memory_error}")

        # Clean up checkpoint data for this session
        try:
            from app.core.graph import cleanup_simulation_checkpoints

            cleanup_simulation_checkpoints(thread_id)
        except Exception as cleanup_error:
            logger.warning(
                f"Failed to cleanup checkpoints for thread {thread_id}: {cleanup_error}"
            )

    except Exception as e:
        logger.error(f"Failed to finalize session: {e}")


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
