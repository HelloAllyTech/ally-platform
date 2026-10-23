"""Queue messaging utilities for session management and backend communication."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import TYPE_CHECKING, List, Optional, Tuple

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator

from app.core.events.schemas import CoreEventMessageType, SessionMemoryData
from app.core.events.utils import get_current_score_from_graph
from app.core.graph.utils import serialize_event
from app.core.logger import get_logger
from app.core.queue import msg_event_queue

logger = get_logger(__name__)


@dataclass
class FinalizeOutcome:
    """Per-step result of ``finalize_session``.

    Exists because the previous single ``except Exception: logger.error(...)``
    made every failure mode look the same — and look the same as "finalize
    hasn't happened yet". Each step now records its own outcome, so a caller
    (and a log reader) can tell "the score was sent but memory failed" from
    "nothing was sent at all".
    """

    room_id: str
    final_score: Optional[int] = None
    #: True only when the queue accepted the end-of-session message.
    score_sent: bool = False
    #: True when the score had to be substituted with 0 because it could not
    #: be resolved. The 0 in ``final_score`` is then NOT a real score.
    score_unavailable: bool = False
    memory_emitted: bool = False
    checkpoints_cleaned: bool = False
    #: (step name, error repr) for every step that failed.
    failures: List[Tuple[str, str]] = field(default_factory=list)

    def add_failure(self, step: str, error: object) -> None:
        self.failures.append((step, repr(error)))

    @property
    def ok(self) -> bool:
        """True when the learner-visible outcome is intact: the score was
        delivered, it was a real score, and nothing else failed."""
        return self.score_sent and not self.score_unavailable and not self.failures

    def describe(self) -> str:
        return (
            f"room={self.room_id} score={self.final_score} "
            f"score_sent={self.score_sent} score_unavailable={self.score_unavailable} "
            f"memory_emitted={self.memory_emitted} "
            f"checkpoints_cleaned={self.checkpoints_cleaned} "
            f"failed_steps={[s for s, _ in self.failures] or 'none'}"
        )


async def send_message_to_queue(message_data: str) -> bool:
    """
    Safely send message to message queue.

    Returns True only when the queue accepted the message (SQS returned a
    MessageId). Previously this returned None and swallowed the queue's own
    boolean, so a send that FAILED was indistinguishable from one that
    succeeded — the caller logged "Sending ..." and moved on either way. The
    return value matters most for the end-of-session score: a dropped send
    leaves the session looking ACTIVE forever on the backend.

    Args:
        message_data: JSON string message to send

    Returns:
        True if the queue accepted the message, False otherwise.
    """
    try:
        return bool(await msg_event_queue.send_message(message_data))
    except Exception as e:
        logger.error(f"Failed to send message to queue: {e}")
        return False


def create_session_end_message(
    room_id: str, final_score: int, reason: Optional[str] = None
) -> CoreEventMessageType:
    """
    Create a session end message with total score for backend.

    This is not an event in the event system - it's a backend indication
    that provides the source of truth for the final score at the end of a call.

    Args:
        room_id: LiveKit room identifier
        final_score: Final total score for the session
        reason: Present only when this end-of-session was produced by the
            emergency/force-exit path (e.g. "watchdog_force_exit") rather than
            a clean shutdown, so ally-be can record that the session ended
            technically rather than normally. Omitted (the normal path) keeps
            the message byte-identical to before this field existed.

    Returns:
        CoreEventMessageType ready to be sent to queue
    """
    event_data = {"id": "end-of-session", "totalScore": final_score}
    if reason:
        event_data["reason"] = reason
    return CoreEventMessageType.create(room_id=room_id, event_data=event_data)


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


def _tail_messages_for_grounding(thread_id: str) -> list:
    """Best-effort transcript for the groundedness cross-check.

    Best-effort on purpose, and the failure is safe in the right direction:
    graph state is legitimately unreadable at session end (ending mid-turn
    cancels the in-flight run), and `check_grounding` treats an empty transcript
    as missing evidence rather than as proof of invention. So an unreadable
    checkpoint costs the check, not the ledger.
    """
    try:
        from app.core.graph import agent_graph

        state = agent_graph.get_state({"configurable": {"thread_id": thread_id}})
        if state and state.values:
            return list(state.values.get("messages") or [])
        return []
    except Exception:  # noqa: BLE001 - the check is a bonus, not a gate
        return []


async def _emit_session_memory(
    room_id: str,
    thread_id: str,
    llm_client=None,
    language_code: str | None = None,
    prompt_data=None,
    rolling_summary_store=None,
    client_working_memory_store=None,
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
        # The two flags are independent (config.py): a disabled rolling
        # summary must not take client working memory down with it. Without a
        # working-memory store there is nothing left to ship at all.
        if client_working_memory_store is None:
            logger.debug(
                "session_memory skipped: ROLLING_SUMMARY_ENABLED is off and no "
                "client_working_memory_store was provided"
            )
            return
        logger.debug(
            "ROLLING_SUMMARY_ENABLED is off; shipping client working memory only"
        )
        rolling_summary_store = None
        llm_client = None

    # Phase 7: the semantic half of the write-out. Folded into `structured`
    # under one namespaced key rather than sent as its own message — ally-be
    # already stores `structured` whole and reads the keys it recognises, so
    # this needs no wire change and no new consumer to be durable.
    #
    # Built ONCE here rather than inside _send, which has three call sites: the
    # groundedness check reads the transcript, and doing it per call site would
    # either duplicate the work or quietly skip it on one path.
    working_memory_record = None
    if client_working_memory_store is not None:
        try:
            from app.core.working_memory.writeout import build_writeout

            snapshot = await client_working_memory_store.snapshot()
            working_memory_record = build_writeout(
                snapshot,
                _tail_messages_for_grounding(thread_id),
                monologue=getattr(client_working_memory_store, "monologue", None),
            )
        except Exception as writeout_error:  # noqa: BLE001
            # A missing semantic record costs the next session its continuity.
            # A failed finalize costs this session its score.
            logger.warning("[working-memory] write-out skipped: %s", writeout_error)

    # SHIP IT FIRST, before the episodic work that can outlive its own budget.
    #
    # Fourth path found for losing this record, and the one that defeated the
    # try/finally below: `finalize_session` awaits this coroutine, and the
    # shutdown drain gives it `wait_for(shield(...), timeout=16.0)`. The final
    # compaction alone can spend 14s of that (two attempts at 8s and 6s), so the
    # drain expires with the coroutine still inside the summary logic — and a
    # `finally` never runs if the coroutine never completes. A shield keeps the
    # task alive but nothing keeps the loop alive.
    #
    # So the semantic record goes out on its own message as soon as it exists,
    # while there is certainly still runway. The normal path below sends again
    # with the summary attached; ally-be's upsert is guarded on coverage and the
    # later message also carries the record, so the second write is an upgrade
    # rather than a clobber.
    record_shipped = False
    if working_memory_record is not None:
        try:
            await _ship_working_memory_only(
                room_id, working_memory_record, language_code
            )
            record_shipped = True
        except Exception as early_error:  # noqa: BLE001
            # Not fatal: the try/finally below is still a second chance.
            logger.warning(
                "[working-memory] early record ship failed for room=%s: %s",
                room_id,
                early_error,
            )

    async def _send(
        summary_text: str,
        message_count: int,
        covered: int,
        structured: dict | None = None,
    ) -> None:
        nonlocal record_shipped
        if working_memory_record is not None:
            structured = dict(structured or {})
            structured["client_working_memory"] = working_memory_record
            record_shipped = True
        memory = SessionMemoryData(
            summary=summary_text,
            language=language_code,
            message_count=message_count,
            summarized_message_count=covered,
            structured=structured,
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

    # try/finally, not a branch. The semantic record does not depend on the
    # episodic summary, and every attempt to express that as one more branch
    # has missed a path: first the emergency finalizer, then `elif not
    # maintained`, then `if upgraded is None: return` — which is how a
    # completed 8/8 Tamil session built an 18-item record and threw it away.
    # A `finally` covers every return, present and future, including a raise.
    try:
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

        message_count = max(
            len(messages), store.total_count if store is not None else 0
        )

        # PHASE 1 — ship the maintained summary IMMEDIATELY (pure SQS send,
        # milliseconds). The disconnect path gives this task almost no runway:
        # the worker's shutdown cancels background tasks and the job process
        # exits within ~2s, which killed the emission entirely when it waited on
        # a final-compaction LLM call first (observed live: the finalize task
        # died inside wait_for and CancelledError skipped every log). Delivering
        # the last good summary must never depend on another LLM round-trip.
        if maintained:
            await _send(
                maintained,
                message_count,
                covered_count,
                structured=getattr(store, "structured", None),
            )

        # PHASE 2 — best-effort upgrade: fold the not-yet-covered tail in and
        # send a message with higher coverage. Core's processor keeps whichever
        # write covers more messages, so a cancelled/never-delivered upgrade (or
        # out-of-order delivery) can't clobber phase 1. This is also what gives
        # SHORT sessions (< one compaction cycle, no maintained summary) a
        # memory at all — when the runway allows it.
        if llm_client is not None and messages and covered_count < len(messages):
            from app.core.graph.rolling_summary import update_rolling_summary

            # Two attempts: a transient LLM stall (observed live: TimeoutError on
            # a 6-exchange session) must not silently lose the session's ONLY
            # memory when there is no maintained summary to fall back on. The
            # retry uses a shorter timeout so both attempts fit the shutdown
            # drain window (handlers.py).
            upgraded = upgraded_structured = None
            for attempt, attempt_timeout in enumerate(
                (settings.ROLLING_SUMMARY_TIMEOUT, 6.0), start=1
            ):
                try:
                    upgraded, upgraded_structured = await asyncio.wait_for(
                        update_rolling_summary(
                            previous_summary=maintained or None,
                            new_messages=messages[covered_count:],
                            llm_client=llm_client,
                            prompt_data=prompt_data,
                            room_id=room_id,
                        ),
                        timeout=attempt_timeout,
                    )
                    break
                except Exception as e:
                    logger.warning(
                        "Final session-memory compaction attempt %d failed (%r); %s",
                        attempt,
                        e,
                        (
                            "retrying once"
                            if attempt == 1
                            else (
                                f"phase-1 summary covering {covered_count}/"
                                f"{message_count} messages already sent"
                                if maintained
                                else "no summary was available to send"
                            )
                        ),
                    )
            if upgraded is None:
                return
            upgraded = (upgraded or "").strip()
            if upgraded and upgraded != maintained:
                await _send(
                    upgraded,
                    len(messages),
                    len(messages),
                    structured=upgraded_structured,
                )
        elif not maintained:
            logger.info(
                "No rolling summary available for room=%s; the semantic record "
                "still ships below if there is one",
                room_id,
            )

    finally:
        if working_memory_record is not None and not record_shipped:
            try:
                await _ship_working_memory_only(
                    room_id, working_memory_record, language_code
                )
            except Exception as ship_error:  # noqa: BLE001
                logger.warning(
                    "[working-memory] standalone record ship failed for " "room=%s: %s",
                    room_id,
                    ship_error,
                )


async def _ship_working_memory_only(
    room_id: str,
    record: dict,
    language_code: str | None,
    send=None,
) -> None:
    """Ship the semantic record with no episodic summary to carry it.

    ally-be requires a non-empty summary to accept the message, so one is
    synthesised that states the stance path and NOTHING else — deliberately not
    a narrative, so nothing downstream can mistake it for a real summary.
    """
    path = " -> ".join(record.get("stance_path") or []) or "unknown"
    memory = SessionMemoryData(
        summary=(
            "(no conversation summary was produced for this session; "
            f"client stance path: {path})"
        ),
        language=language_code,
        message_count=0,
        summarized_message_count=0,
        structured={"client_working_memory": record},
    )
    message = CoreEventMessageType.create_session_memory(
        room_id=room_id, session_memory=memory
    )
    logger.info("Shipping the working-memory record on its own for room=%s", room_id)
    await (send or send_message_to_queue)(message.model_dump_json())


async def finalize_session(
    room_id: str,
    thread_id: str,
    event_orchestrator=None,
    score_keeper=None,
    llm_client=None,
    language_code: str | None = None,
    prompt_data=None,
    rolling_summary_store=None,
    client_working_memory_store=None,
) -> FinalizeOutcome:
    """
    Finalize a session by sending final score and cleaning up resources.

    This function performs session cleanup tasks:
    1. Sends final score to backend queue
    2. Ships the episodic-memory summary (session_memory) to backend
    3. Cleans up checkpoint data to prevent memory leaks

    Each step is independently guarded and recorded on the returned
    ``FinalizeOutcome`` — a failure in one step never skips a later one, and
    in particular a failure resolving the score never skips the score SEND
    (the message that takes the session out of ACTIVE on the backend). Never
    raises: callers run it from shutdown callbacks where an exception would
    lose the rest of teardown.

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
    outcome = FinalizeOutcome(room_id=room_id)

    # ---- STEP 1: resolve the final score ----------------------------------
    # Isolated from the send. Previously one outer `except Exception` wrapped
    # the score computation, the score send, the memory emission AND the
    # checkpoint cleanup, so a failure resolving the score silently skipped
    # the SEND too — and the only trace was one generic line that was
    # indistinguishable from "finalize hasn't run yet".
    final_score: int | None = None
    if score_keeper is not None:
        try:
            final_score = score_keeper.get_total_score()
            logger.info(
                f"Final score from ScoreKeeper — events: {score_keeper.event_score}, "
                f"behaviors: {score_keeper.behavior_score}, total: {final_score}"
            )
        except Exception as score_error:  # noqa: BLE001
            outcome.add_failure("score_from_score_keeper", score_error)
            logger.exception(
                "[FINALIZE] score_from_score_keeper FAILED room=%s (%r) — "
                "falling back to graph state",
                room_id,
                score_error,
            )
    if final_score is None:
        try:
            final_score = get_current_score_from_graph(thread_id)
            if score_keeper is None:
                logger.warning(
                    "ScoreKeeper not provided, falling back to graph state score"
                )
        except Exception as graph_error:  # noqa: BLE001
            outcome.add_failure("score_from_graph", graph_error)
            logger.exception(
                "[FINALIZE] score_from_graph FAILED room=%s (%r)", room_id, graph_error
            )

    # ---- STEP 2: send the end-of-session message --------------------------
    # This is the message that takes the session out of ACTIVE on the backend,
    # so it is sent even when the score could not be resolved: a session
    # closed with a possibly-wrong score is recoverable, one stuck ACTIVE
    # forever is not. The substitution is logged at ERROR so it is never
    # mistaken for a real zero.
    if final_score is None:
        final_score = 0
        outcome.score_unavailable = True
        logger.error(
            "[FINALIZE] score UNAVAILABLE room=%s — sending end-of-session with "
            "totalScore=0 so the session does not stay ACTIVE. This 0 is NOT a "
            "real score.",
            room_id,
        )
    outcome.final_score = final_score

    try:
        core_message = create_session_end_message(room_id, final_score)
        logger.info(
            f"Sending end-of-session message {core_message} with final "
            f"score {final_score} to backend"
        )
        outcome.score_sent = await send_message_to_queue(core_message.model_dump_json())
        if not outcome.score_sent:
            # One retry: the score send is a single small SQS call and losing
            # it costs the learner the whole session's score.
            logger.error(
                "[FINALIZE] end_of_session send REJECTED room=%s — retrying once",
                room_id,
            )
            outcome.score_sent = await send_message_to_queue(
                core_message.model_dump_json()
            )
        if not outcome.score_sent:
            outcome.add_failure("end_of_session_send", "queue did not accept message")
            logger.error(
                "[FINALIZE] end_of_session send FAILED room=%s score=%s — the "
                "backend will not see this session as scored",
                room_id,
                final_score,
            )
    except Exception as send_error:  # noqa: BLE001
        outcome.add_failure("end_of_session_send", send_error)
        logger.exception(
            "[FINALIZE] end_of_session send FAILED room=%s (%r)", room_id, send_error
        )

    # ---- STEP 3: episodic memory -----------------------------------------
    # Must run BEFORE checkpoint cleanup below — the rolling summary lives in
    # the LangGraph checkpoint. Never blocks finalize on failure.
    try:
        await _emit_session_memory(
            room_id=room_id,
            thread_id=thread_id,
            llm_client=llm_client,
            language_code=language_code,
            prompt_data=prompt_data,
            rolling_summary_store=rolling_summary_store,
            client_working_memory_store=client_working_memory_store,
        )
        outcome.memory_emitted = True
    except Exception as memory_error:  # noqa: BLE001
        outcome.add_failure("session_memory", memory_error)
        logger.exception(
            "[FINALIZE] session_memory FAILED room=%s (%r) — the next session "
            "loses continuity, the score is unaffected",
            room_id,
            memory_error,
        )

    # ---- STEP 4: checkpoint cleanup --------------------------------------
    try:
        from app.core.graph import cleanup_simulation_checkpoints

        cleanup_simulation_checkpoints(thread_id)
        outcome.checkpoints_cleaned = True
    except Exception as cleanup_error:  # noqa: BLE001
        outcome.add_failure("checkpoint_cleanup", cleanup_error)
        logger.warning(
            f"[FINALIZE] checkpoint_cleanup FAILED for thread {thread_id}: "
            f"{cleanup_error}"
        )

    # One greppable summary line per session, so "did finalize run, and what
    # part of it worked?" is answerable from the logs without correlating four
    # separate messages.
    if outcome.ok:
        logger.info("[FINALIZE] complete %s", outcome.describe())
    else:
        logger.error("[FINALIZE] PARTIAL %s", outcome.describe())
    return outcome


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
