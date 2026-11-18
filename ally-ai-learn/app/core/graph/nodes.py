import asyncio
import functools
import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, cast

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from langchain_core.runnables import RunnableConfig

from app.core.agent.glossary_swap import swap_complete_text, swap_table_for
from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, DetectionType
from app.core.events.base import BaseEvent
from app.core.events.event_types.binary_classifier.binary_classifier_event import (
    BinaryClassifierEvent,
)
from app.core.events.handlers import send_event_to_ui
from app.core.events.schemas import CoreEventMessageType, CustomUIEventMessageType
from app.core.graph.instrumentation import (
    get_invocation_id,
    get_room_id,
    instrumented_node,
    log_side_effect,
)
from app.core.graph.knowledge_locks import has_locks as has_memory_locks
from app.core.graph.knowledge_locks import locked_topics as locked_memory_topics
from app.core.graph.knowledge_locks import partition_sources as partition_memory_sources
from app.core.graph.knowledge_locks import resolve_for_turn as resolve_memory_locks
from app.core.graph.knowledge_retrieval import (
    build_knowledge_map,
    retrieve_relevant_knowledge,
    selected_glossary_sections,
)
from app.core.graph.prompt import (
    _get_selected_prompt_has_states as _selected_prompt_has_states_for_retrieval,
)
from app.core.graph.prompt import (
    _resolve_simulation_state_by_score as _resolve_state_for_retrieval,
)
from app.core.graph.prompt import (
    generate_system_message,
    prompt_declares_client_working_memory,
    prompt_declares_stage_director,
)
from app.core.graph.state import (
    BehaviorInstructionFeedbackData,
    BranchingAndFeedbackData,
    SimulationState,
)
from app.core.graph.utils import (
    calculate_elapsed_time,
    convert_messages_to_chat_messages,
    get_live_score,
    is_event_eligible,
)
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import logger
from app.core.metrics import turn_metrics
from app.core.queue import msg_event_queue
from app.core.scenario.base import (
    Scenario,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.core.scoring.score_keeper import ScoreKeeper
from app.core.time_utils import TimingContext, time_operation
from app.llms import create_llm_client
from app.prompts.resolver import load_template


def _resolve_current_state(
    state_instructions: Optional[list],
    current_score: int,
) -> Optional[SimulationStateInstruction]:
    """
    Resolve the current state instruction based on the cumulative score.

    Iterates through state instructions and returns the one whose score
    window (score_lower, score_upper) contains the current_score.
    Boundaries of None represent -infinity (lower) or +infinity (upper).

    Args:
        state_instructions: List of SimulationStateInstruction with score bounds.
        current_score: The current cumulative score from the simulation state.

    Returns:
        The matching SimulationStateInstruction, or None if no match found.
    """
    if not state_instructions:
        return None

    for si in state_instructions:
        lower = si.score_lower if si.score_lower is not None else float("-inf")
        upper = si.score_upper if si.score_upper is not None else float("inf")
        if lower <= current_score <= upper:
            return si

    return None


def _prepare_event_context(
    state: SimulationState, config: Optional[RunnableConfig]
) -> tuple:
    """Prepare context for event processing."""
    chat_messages = convert_messages_to_chat_messages(state.messages)
    elapsed_time = calculate_elapsed_time(config)
    live_score = get_live_score(config)

    orchestrator = None
    room = None
    if config and "configurable" in config:
        orchestrator = config["configurable"].get("event_orchestrator")
        room = config["configurable"].get("room")

    logger.debug(f"Event Cycle: Time={elapsed_time:.2f}s, Live Score={live_score}")
    return chat_messages, elapsed_time, live_score, orchestrator, room


async def _detect_events(
    permitted_events: list[BaseEvent],
    chat_messages: list,
    elapsed_time: float,
    live_score: int,
    orchestrator,
) -> tuple[list[tuple[str, BaseEvent]], list[BaseEvent]]:
    """
    Detect events that are eligible and trigger detection.

    All eligible events are detected in parallel for optimal performance.

    Returns:
        Tuple of (detected_events_with_timestamps, new_events)
        - detected_events_with_timestamps: List of (timestamp, event) tuples
        - new_events: List of detected events (without timestamps)
    """

    concurrency_limit = max(1, settings.EVENT_DETECTION_CONCURRENCY_LIMIT)
    semaphore = asyncio.Semaphore(concurrency_limit)

    async def detect_single_event(event: BaseEvent):
        """
        Detect a single event with error handling and timeout.

        Adds timeout to prevent slow API calls from blocking all event detection.
        This improves reliability and prevents cascading delays.
        """
        _start = datetime.now(timezone.utc)
        outcome = "false"
        try:
            async with semaphore:
                if settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS:
                    # Add timeout to prevent slow API calls from blocking everything
                    # 10s is reasonable to prevent slow API calls (binary classifier,
                    # embeddings) from blocking the simulation flow.
                    result = await asyncio.wait_for(
                        event.detect_event(chat_messages), timeout=10.0
                    )
                else:
                    # Old behavior: no timeout
                    result = await event.detect_event(chat_messages)
                outcome = "true" if result else "false"
                if result:
                    return event
        except asyncio.TimeoutError:
            outcome = "timeout"
            logger.warning(
                f"Event {event.event_id} detection timed out after 10s, skipping"
            )
        except Exception as e:
            outcome = "error"
            logger.exception(f"Event {event.event_id} detection failed: {e}")
        finally:
            # Per-event timing for deep dives — DEBUG keeps it out of prod INFO.
            _ms = (datetime.now(timezone.utc) - _start).total_seconds() * 1000
            logger.debug(
                "[EVENT_TIMING] event_id=%s type=%s latency_ms=%.1f detected=%s",
                getattr(event, "event_id", "?"),
                type(event).__name__,
                _ms,
                outcome,
            )
        return None

    # Collect eligible events
    eligible_events = []
    skipped_count = 0

    for event in permitted_events:
        last_occurred_at = None
        occurrence_count = 0

        if orchestrator:
            last_occurred_at = orchestrator.get_last_occurred_at(event.event_id)
            occurrence_count = orchestrator.get_occurrence_count(event.event_id)

        if is_event_eligible(
            event, elapsed_time, live_score, last_occurred_at, occurrence_count
        ):
            eligible_events.append(event)
        else:
            skipped_count += 1

    if skipped_count > 0:
        logger.debug(
            f"Event optimization: Skipped {skipped_count} events (outside windows)."
        )

    async def run_binary_batch(group: list[BaseEvent]) -> list[BaseEvent]:
        """Classify a group of BinaryClassifier events in one LLM call.

        Falls back to per-event detection on any failure/timeout so detection
        never regresses. Honors the same semaphore as per-event detection.
        """
        last = chat_messages[-1] if chat_messages else None
        if last is None or last.role.lower() != "counselor":
            return []
        _start = datetime.now(timezone.utc)
        try:
            async with semaphore:
                matched = await asyncio.wait_for(
                    BinaryClassifierEvent.classify_batch(group, last.content),
                    timeout=10.0,
                )
            detected = [e for e in group if e.event_id in matched]
        except Exception as e:
            logger.warning(
                "[EVENT_BATCH] batch classify of %d events failed (%s); "
                "falling back to per-event",
                len(group),
                e,
            )
            results = await asyncio.gather(*[detect_single_event(e) for e in group])
            detected = [r for r in results if r is not None]
        finally:
            _ms = (datetime.now(timezone.utc) - _start).total_seconds() * 1000
            logger.debug(
                "[EVENT_BATCH] classified %d binary events in %.1fms",
                len(group),
                _ms,
            )
        return detected

    # When batching is enabled, collapse BinaryClassifier events that share a
    # model into a single LLM call; everything else keeps its per-event task.
    batch_groups: list[list[BaseEvent]] = []
    per_event_events = eligible_events
    if settings.BATCH_EVENT_CLASSIFIERS:
        binary_events = [
            e
            for e in eligible_events
            if e.detection_type == DetectionType.BINARY_CLASSIFIER
        ]
        if len(binary_events) >= 2:
            by_model: dict[str, list[BaseEvent]] = {}
            for e in binary_events:
                by_model.setdefault(getattr(e, "model", ""), []).append(e)
            batch_groups = [g for g in by_model.values() if len(g) >= 2]
            batched_ids = {e.event_id for g in batch_groups for e in g}
            per_event_events = [
                e for e in eligible_events if e.event_id not in batched_ids
            ]

    # Detect events in parallel: per-event tasks + one task per batch group.
    detection_tasks = [
        asyncio.create_task(detect_single_event(event)) for event in per_event_events
    ]
    detection_tasks += [
        asyncio.create_task(run_binary_batch(group)) for group in batch_groups
    ]

    detected_events_with_timestamps = []

    if detection_tasks:
        logger.debug(
            "Detecting %d events (%d batched binary groups) in parallel",
            len(per_event_events),
            len(batch_groups),
        )
        for t in asyncio.as_completed(detection_tasks):
            result = await t
            if result is None:
                continue
            events_found = result if isinstance(result, list) else [result]
            for ev in events_found:
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                detected_events_with_timestamps.append((timestamp, ev))

    logger.debug(f"Detected {len(detected_events_with_timestamps)} events")
    new_events = [event for _, event in detected_events_with_timestamps]
    return detected_events_with_timestamps, new_events


def _split_events_by_type(
    all_feedback_data: list[BranchingAndFeedbackData],
) -> tuple[list[BranchingAndFeedbackData], list[BranchingAndFeedbackData]]:
    """Split events into branching and non-branching based on feature flag."""
    if settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS:
        # NEW WAY: Split events into branching vs non-branching
        with time_operation("Event split (parallel mode)"):
            branching_and_feedback_data = []
            non_branching_feedback_data = []

            for data in all_feedback_data:
                if data.branching_instruction is not None:
                    branching_and_feedback_data.append(data)
                else:
                    non_branching_feedback_data.append(data)

        logger.info(
            f"[PARALLEL MODE] Event split: "
            f"{len(branching_and_feedback_data)} branching, "
            f"{len(non_branching_feedback_data)} non-branching"
        )
    else:
        # OLD WAY: All events go into branching_and_feedback_data
        with time_operation("Event split (sequential mode)"):
            branching_and_feedback_data = all_feedback_data.copy()
            non_branching_feedback_data = []

        logger.info(
            f"[SEQUENTIAL MODE] All {len(branching_and_feedback_data)} events "
            f"processed sequentially"
        )

    return branching_and_feedback_data, non_branching_feedback_data


def _log_event_data(all_feedback_data: list[BranchingAndFeedbackData]) -> None:
    """Log collected event data for debugging."""
    if not all_feedback_data:
        return

    logger.info("Branching and Feedback Data Collected:")
    for idx, data in enumerate(all_feedback_data, 1):
        feedback_msg = (
            data.feedback.message if data.feedback and data.feedback.message else "None"
        )
        event_type = "BRANCHING" if data.branching_instruction else "NON-BRANCHING"
        logger.info(
            f"    [{idx}] [{event_type}] Event Score: {data.score} | "
            f"Branching: {data.branching_instruction or 'None'} | "
            f"Feedback: {feedback_msg}"
        )


async def _orchestrate_and_split_events(
    orchestrator,
    room,
    new_events: list[BaseEvent],
) -> tuple[int, list[BranchingAndFeedbackData], list[BranchingAndFeedbackData]]:
    """Orchestrate events and split them by type."""
    detected_event_ids = {event.event_id for event in new_events}

    # Wrap event orchestration in asyncio.wait_for so a slow upstream cannot park
    # the turn. NOTE: orchestrate_events makes NO LLM calls — it updates the event
    # registry, commits scores, sends events to Core (SQS), and handles
    # termination; branching-instruction LLM resolution happens later in
    # resolve_branching_instruction. The on-gate cost here is the SQS round-trip +
    # ScoreKeeper lock. On timeout we return empty results so the agent can still
    # produce a response. See ORCHESTRATION_TIMEOUT in app/core/config.py.
    _orch_start = datetime.now(timezone.utc)
    logger.info(
        "[orchestrate_events] orchestration_start timeout=%ss events=%d",
        settings.ORCHESTRATION_TIMEOUT,
        len(new_events),
    )
    log_side_effect(
        "orchestrate_events_begin",
        events=len(new_events),
        detected_ids=",".join(sorted(detected_event_ids)) or "none",
    )
    try:
        with time_operation("Event orchestration"):
            (
                _,
                additional_score,
                all_feedback_data,
            ) = await asyncio.wait_for(
                orchestrator.orchestrate_events(
                    room=room,
                    detected_event_ids=(
                        detected_event_ids if detected_event_ids else None
                    ),
                ),
                timeout=settings.ORCHESTRATION_TIMEOUT,
            )
        log_side_effect(
            "orchestrate_events_complete",
            additional_score=additional_score,
            feedback_count=len(all_feedback_data),
        )
        _orch_latency = (datetime.now(timezone.utc) - _orch_start).total_seconds()
        logger.info(
            "Event orchestration completed (total events: %d, latency_s=%.2f)",
            len(all_feedback_data),
            _orch_latency,
        )
        turn_metrics.record(
            get_room_id(),
            orchestration_ms=int(_orch_latency * 1000),
            events_detected=len(new_events),
            invocation_id=get_invocation_id(),
        )
    except asyncio.TimeoutError:
        _orch_latency = (datetime.now(timezone.utc) - _orch_start).total_seconds()
        logger.error(
            "[orchestrate_events] orchestration_timeout room=%s latency_s=%.2f "
            "timeout=%ss events=%d — returning empty results",
            get_room_id(),
            _orch_latency,
            settings.ORCHESTRATION_TIMEOUT,
            len(new_events),
        )
        turn_metrics.record(get_room_id(), orchestration_ms=int(_orch_latency * 1000))
        return 0, [], []

    branching_data, non_branching_data = _split_events_by_type(all_feedback_data)
    _log_event_data(all_feedback_data)

    return additional_score, branching_data, non_branching_data


def _calculate_score_updates(
    state: SimulationState,
    new_events: list[BaseEvent],
    additional_score_from_triggered_events: int,
) -> int:
    """Calculate score updates for this turn."""
    direct_score_change = sum(event.score for event in new_events if event.score)
    total_turn_score_delta = (
        direct_score_change + additional_score_from_triggered_events
    )
    new_current_score = state.current_score + total_turn_score_delta

    if total_turn_score_delta != 0:
        logger.info(
            f"Total Score Update: {state.current_score} → {new_current_score} "
            f"(Delta: {total_turn_score_delta:+d})"
        )

    return new_current_score


def _build_state_update_dict(
    state: SimulationState,
    detected_events: list,
    new_events: list[BaseEvent],
    new_current_score: int,
    branching_and_feedback_data: list[BranchingAndFeedbackData],
    non_branching_feedback_data: list[BranchingAndFeedbackData],
) -> dict:
    """Build the state update dictionary."""
    update_dict = {
        "events_accumulator": detected_events,
        "new_events": new_events,
        "current_score": new_current_score,
    }

    # Always write these fields so the reducer runs and clears stale data
    # from the previous turn. Use None (not []) as the intentional-clear signal
    # so subgraph no-ops (which pass []) are distinguished from real clears.
    if branching_and_feedback_data:
        update_dict["branching_and_feedback_data"] = branching_and_feedback_data
        mode_text = (
            "branching events for sequential processing"
            if settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS
            else "events for sequential processing (legacy mode)"
        )
        logger.info(f"Stored {len(branching_and_feedback_data)} {mode_text}")
    else:
        update_dict["branching_and_feedback_data"] = None

    if non_branching_feedback_data:
        update_dict["non_branching_feedback_data"] = non_branching_feedback_data
        logger.info(
            f"Stored {len(non_branching_feedback_data)} non-branching events "
            f"(processed asynchronously, no blocking)"
        )
    else:
        update_dict["non_branching_feedback_data"] = None

    return update_dict


async def _publish_done_thinking(room) -> None:
    """Publish done_thinking signal — always called after voice chain completes."""
    if not room:
        return
    try:
        await room.local_participant.publish_data(
            json.dumps({"type": "AGENT_STATE", "state": "done_thinking"}).encode(),
            reliable=True,
        )
    except Exception as e:
        logger.warning(f"Failed to publish done_thinking state: {e}")


@instrumented_node("publish_done_thinking")
async def publish_done_thinking(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> Dict:
    """Terminal node on the agent reply path: publish the done_thinking signal
    once the spoken reply has finished generating.

    Makes no LLM calls, so it needs no subgraph isolation and nothing streams
    to TTS/UI from here.
    """
    room = None
    if config and "configurable" in config:
        room = config["configurable"].get("room")
    await _publish_done_thinking(room)
    return {}


async def _process_events_impl(
    state: SimulationState,
    config: Optional[RunnableConfig],
    permitted_events: list,
) -> dict:
    """Shared event-processing pass over ``permitted_events``.

    Backs both process_events (all events) and process_gating_events (the gating
    subset, for EVENTS_OFF_GATE_DEFER_DETECTION). Kept as a plain helper (not a
    graph node) so callers can pass an event subset without routing kwargs
    through the instrumentation decorator.

    NOTE: orchestrate_events processes ALL events in registry where happened=True,
    not just the ones we pass. This means we cannot safely call it multiple times
    with subsets of events, as it would cause double-processing, double-scoring,
    and duplicate event sending.
    """
    # Pause gate: while paused, skip all detection, orchestration, and scoring so
    # nothing fires on paused time. Turn-taking is already frozen by the worker;
    # this is the defensive belt-and-suspenders if a turn slips through.
    if config and "configurable" in config:
        _clock = config["configurable"].get("session_clock")
        if _clock is not None and _clock.is_paused:
            logger.info("[PAUSE] process_events skipped — session paused")
            return {}

    room = None
    if config and "configurable" in config:
        room = config["configurable"].get("room")

    # Record the active language every turn — process_events always runs, so this
    # keeps the `language` metric dimension populated even on turns that don't
    # reach generate_response (where it was previously recorded).
    if config and "configurable" in config:
        _scn = config["configurable"].get("scenario")
        _lang = getattr(getattr(_scn, "language_config", None), "language_code", None)
        if _lang:
            turn_metrics.record(get_room_id(), language=_lang)

    if room:
        try:
            log_side_effect("ui_publish_thinking_state")
            await room.local_participant.publish_data(
                json.dumps({"type": "AGENT_STATE", "state": "thinking"}).encode(),
                reliable=True,
            )
        except Exception as e:
            logger.warning(f"Failed to publish thinking state: {e}")

    with TimingContext("process_events") as timing:
        # 1. Prepare context
        with timing.operation("Context preparation"):
            chat_messages, elapsed_time, live_score, orchestrator, room = (
                _prepare_event_context(state, config)
            )

        # 2. Detect events in parallel (over the given permitted subset)
        with timing.operation("Event detection"):
            detected_events, new_events = await _detect_events(
                permitted_events,
                chat_messages,
                elapsed_time,
                live_score,
                orchestrator,
            )

        # 3. Orchestrate and split events
        # (all events together to avoid duplicate processing)
        # NOTE: orchestrate_events makes NO LLM calls — it updates the event
        # registry, commits scores, sends events to Core (SQS), and handles
        # termination. The on-gate cost is the SQS round-trip + ScoreKeeper lock.
        additional_score = 0
        branching_and_feedback_data = []
        non_branching_feedback_data = []

        if orchestrator is not None:
            with timing.operation("Orchestration and splitting"):
                (
                    additional_score,
                    branching_and_feedback_data,
                    non_branching_feedback_data,
                ) = await _orchestrate_and_split_events(orchestrator, room, new_events)

            if additional_score != 0:
                logger.info(
                    f"Additional score from triggered events: {additional_score:+d}"
                )

        # 4. Calculate score updates
        with timing.operation("Score calculation"):
            new_current_score = _calculate_score_updates(
                state, new_events, additional_score
            )
        # 5. Build state update dict
        with timing.operation("State update dict building"):
            result = _build_state_update_dict(
                state,
                detected_events,
                new_events,
                new_current_score,
                branching_and_feedback_data,
                non_branching_feedback_data,
            )

        timing.log_summary()

        return result


@instrumented_node("process_events")
async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Process events, optimizing detection based on Time, Score, and Cooldown windows.
    Collects branching_and_feedback_data for later processing. Detects over the
    full permitted-events set (the default graph topology).
    """
    return await _process_events_impl(state, config, state.permitted_events)


@instrumented_node("process_gating_events")
async def process_gating_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """Gate-path event processing for EVENTS_OFF_GATE_DEFER_DETECTION.

    Runs the full pass (detection + the single registry/cascade/combination pass
    + scoring + termination) but over ONLY the gating subset: branching,
    guardrail, termination, and combination-referenced events. The reply gates on
    this node; the remaining independent non-branching events are detected off
    the gate as a genuinely detached background task (_run_deferred_events),
    spawned below rather than wired as a graph node/edge — see that function's
    docstring and EVENTS_OFF_GATE_DEFER_DETECTION for why a graph node would
    still block the reply despite nothing on the reply path needing its output.
    """
    orchestrator = (
        config["configurable"].get("event_orchestrator")
        if config and "configurable" in config
        else None
    )
    deferrable = (
        orchestrator.deferrable_detection_event_ids
        if orchestrator is not None
        else set()
    )
    gate_permitted = [e for e in state.permitted_events if e.event_id not in deferrable]
    result = await _process_events_impl(state, config, gate_permitted)
    if orchestrator is not None:
        orchestrator._spawn_background(
            _run_deferred_events(state, config, orchestrator),
            label="process_deferred_events",
        )
    return result


async def _send_deferred_ui_feedback(
    feedback: list[BranchingAndFeedbackData], room
) -> None:
    """Send a standalone UI score update for deferred (off-gate) events.

    send_event_feedback (the graph node) merges branching + non-branching +
    behavior feedback into ONE cumulative per-turn message — it assumes all
    three are available in the same superstep. Deferred events resolve on a
    genuinely detached background task (see _run_deferred_events) that can
    finish well after send_event_feedback has already fired for this turn,
    so they can't join that merge. This mirrors the same selection logic
    (highest-|score| feedback message, summed score) scoped to just this
    detection, firing its own UI push whenever it's ready.
    """
    if room is None or not feedback:
        return
    events_with_feedback = [ed for ed in feedback if ed.feedback is not None]
    if not events_with_feedback:
        return
    cumulative_score = sum(ed.score for ed in events_with_feedback)
    selected = max(events_with_feedback, key=lambda e: abs(e.score))
    detected_event_ids = [ed.event_id for ed in events_with_feedback]
    ui_message = CustomUIEventMessageType.create(
        score=cumulative_score,
        emoji=selected.feedback.emoji,
        message=selected.feedback.message or "",
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        show_feedback=selected.feedback.show_feedback,
        detected_event_ids=detected_event_ids,
    )
    log_side_effect(
        "ui_publish_score_deferred",
        cumulative_score=cumulative_score,
        event_count=len(events_with_feedback),
    )
    await send_event_to_ui(ui_message, room)


async def _run_deferred_events(
    state: SimulationState, config: Optional[RunnableConfig], orchestrator
) -> None:
    """Off-gate detection + processing for non-reply-shaping events.

    Spawned as a genuinely DETACHED background task from process_gating_events
    (via orchestrator._spawn_background) rather than being a graph node.
    LangGraph schedules nodes in "supersteps" with a hard barrier between
    them — a graph node here would still block resolve_branching_instruction/
    generate_response on this work every turn (confirmed in production:
    process_gating_events completing put this and
    sync_events_and_behaviors_node in the same superstep, so the reply waited
    on deferred detection's full duration despite depending only on the
    latter). Being outside the graph entirely means it cannot participate in
    any superstep and therefore cannot block the reply. Detects ONLY the
    deferrable leaf events and scores/sends them via
    orchestrator.orchestrate_deferred_events — without re-running the
    registry/cascade/combination pass. See EVENTS_OFF_GATE_DEFER_DETECTION.
    """
    # Pause gate (mirror process_events): do nothing while paused.
    if config and "configurable" in config:
        _clock = config["configurable"].get("session_clock")
        if _clock is not None and _clock.is_paused:
            return

    deferrable = orchestrator.deferrable_detection_event_ids
    if not deferrable:
        return

    deferred_permitted = [e for e in state.permitted_events if e.event_id in deferrable]
    if not deferred_permitted:
        return

    # orchestrator is deliberately NOT re-taken from this tuple: it's already
    # the same object passed into this function (both ultimately come from
    # config["configurable"]["event_orchestrator"]) — reassigning it here was
    # a redundant, easy-to-misread shadow of the parameter.
    chat_messages, elapsed_time, live_score, _orchestrator_unused, room = (
        _prepare_event_context(state, config)
    )

    _, new_events = await _detect_events(
        deferred_permitted, chat_messages, elapsed_time, live_score, orchestrator
    )
    detected_ids = {e.event_id for e in new_events}
    if not detected_ids:
        return

    feedback = await orchestrator.orchestrate_deferred_events(detected_ids, room)
    await _send_deferred_ui_feedback(feedback, room)


@instrumented_node("resolve_branching_instruction")
async def resolve_branching_instruction(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Resolve branching instruction with LLM calls if needed.

    This function:
    1. Determines branching instruction for LLM (only if branching_instruction exists)
    2. Resolves LLM response tags in branching instructions (if needed)
    3. Selects feedback message from branching events only:
       - If branching event was selected: use its feedback
       - Non-branching events are handled separately (merged in generate_response)

    This node is wrapped in a subgraph to prevent its LLM outputs from being
    streamed to TTS/UI (workaround for LiveKit issue #2836).

    Branching Instruction Logic:
    - Only use branching_instruction if it exists (highest score branching event)
    - If no branching_instruction exists, LLM response is generated without it

    Feedback Selection Logic:
    - Priority 1: If branching event was selected, use its feedback for UI
    - Priority 2: Non-branching events are merged in generate_response
    """
    logger.info("Resolving branching instruction")

    next_instruction = None
    selected_branching_event_data = None

    with TimingContext("Branching instruction resolution") as timing:
        # Process events based on feature flag
        # In parallel mode: only branching events are here
        # In sequential mode: all events are here (old behavior)
        if state.branching_and_feedback_data:
            # All events in branching_and_feedback_data have branching_instruction
            # (they were filtered in process_events)
            branching_events = state.branching_and_feedback_data

            if branching_events:
                # Filter to only events with branching instructions
                # (in parallel mode, all have them; in sequential mode, we filter)
                events_with_branching = [
                    ed
                    for ed in branching_events
                    if ed.branching_instruction is not None
                ]

                if events_with_branching:
                    # Check for guardrail events first (they always take priority)
                    guardrail_events = [
                        e
                        for e in events_with_branching
                        if getattr(e, "event_id", "").startswith("guardrail-")
                    ]

                    if guardrail_events:
                        selected_branching_event_data = guardrail_events[0]
                    else:
                        # Use highest score event with branching instruction for LLM
                        selected_branching_event_data = max(
                            events_with_branching, key=lambda e: abs(e.score)
                        )
                    instruction = selected_branching_event_data.branching_instruction

                    # Get language_code and branching_llm_config from scenario
                    # Use dedicated branching_llm_config for structured output,
                    # falling back to llm_config if not specified
                    language_code = DEFAULT_LANGUAGE_CODE
                    llm_config_for_branching = None
                    branching_llm_client = None
                    scenario = None
                    if config and "configurable" in config:
                        scenario = config["configurable"].get("scenario")
                        if scenario and hasattr(scenario, "language_config"):
                            language_code = scenario.language_config.language_code
                            llm_config_for_branching = (
                                scenario.language_config.branching_llm_config
                            )
                        if llm_config_for_branching is None:
                            branching_llm_client = config["configurable"].get(
                                "llm_client"
                            )

                        # Prompt-level override for the branching skill: when the
                        # branching prompt sets a model/temperature, build a
                        # dedicated client honoring it. No override → unchanged
                        # (the existing branching_llm_config / main-client path).
                        if scenario is not None:
                            from app.core.agent.factory import (
                                build_llm_client_for_prompt,
                                get_prompt_llm_overrides,
                            )

                            _b_code = "ally_ai_learn_system_branching_agent_prompt"
                            _b_provider, _b_model, _b_temp = get_prompt_llm_overrides(
                                getattr(scenario, "prompt_data", None), _b_code
                            )
                            if (
                                _b_provider is not None
                                or _b_model is not None
                                or _b_temp is not None
                            ):
                                branching_llm_client = build_llm_client_for_prompt(
                                    scenario,
                                    _b_code,
                                    base_llm_config=llm_config_for_branching,
                                    language_code=language_code,
                                )
                                llm_config_for_branching = None

                    # Lazily resolve llm_response tags if present (BLOCKING operation).
                    # Wrapped in asyncio.wait_for so a hanging upstream LLM cannot
                    # park this node indefinitely (would manifest as the user being
                    # stuck on the "thinking" indicator).
                    if instruction.needs_llm_resolution():
                        logger.info(
                            "Resolving LLM response tags for branching instruction "
                            "(this may block on LLM call)"
                        )
                        with timing.operation("LLM resolution (blocking)"):
                            resolve_kwargs = {
                                "llm_config": llm_config_for_branching,
                                "language_code": language_code,
                                # The session's Skills Store prompts.
                                "prompt_data": getattr(scenario, "prompt_data", None),
                            }
                            if branching_llm_client is not None:
                                resolve_kwargs["llm_client"] = branching_llm_client
                            try:
                                await asyncio.wait_for(
                                    instruction.resolve_llm_responses(**resolve_kwargs),
                                    timeout=10.0,
                                )
                            except asyncio.TimeoutError:
                                logger.warning(
                                    "Branching LLM resolution timed out after 10s; "
                                    "proceeding with unresolved instruction"
                                )

                    # Use the branching instruction content
                    # (with llm_response tags resolved). Same timeout guard.
                    dynamic_kwargs = {
                        "messages": state.messages,
                        "llm_config": llm_config_for_branching,
                        "language_code": language_code,
                        "prompt_data": getattr(scenario, "prompt_data", None),
                    }
                    if branching_llm_client is not None:
                        dynamic_kwargs["llm_client"] = branching_llm_client
                    try:
                        next_instruction = await asyncio.wait_for(
                            instruction.resolve_dynamic_branching_instruction(
                                **dynamic_kwargs
                            ),
                            timeout=15.0,
                        )
                    except asyncio.TimeoutError:
                        logger.warning(
                            "Dynamic branching instruction resolution timed out "
                            "after 15s; falling back to instruction.content"
                        )
                        next_instruction = getattr(instruction, "content", None)

                    logger.info("Using next instruction: %s", next_instruction)

    # Determine feedback message for UI from branching events only
    # Priority 1: If branching event was selected, use its feedback
    # Priority 2: Non-branching events are merged in generate_response
    feedback_to_send = None
    if selected_branching_event_data and selected_branching_event_data.feedback:
        # Use feedback from the selected branching event
        feedback_to_send = selected_branching_event_data.feedback
        logger.info("Priority 1: Using feedback from selected branching event for UI")
    elif state.branching_and_feedback_data:
        # Fallback: use highest score branching event's feedback
        # (though this shouldn't happen if selected_branching_event_data is set)
        events_with_feedback = [
            ed for ed in state.branching_and_feedback_data if ed.feedback is not None
        ]
        if events_with_feedback:
            selected_event_data = max(events_with_feedback, key=lambda e: abs(e.score))
            feedback_to_send = selected_event_data.feedback
            logger.info(
                f"Fallback: Selected highest score branching event "
                f"(score={selected_event_data.score}) for UI feedback"
            )

    # Snapshot the SHOULD_DO behaviours that advanced the score this turn
    # HERE, before the fan-out to send_event_feedback (which unconditionally
    # clears behavior_feedback_data) and generate_response ->
    # publish_done_thinking -> update_working_memory (which needs this data
    # and runs strictly after send_event_feedback has already cleared it).
    advancing_behaviour_ids = [
        str(f.behavior_instruction_id)
        for f in (state.behavior_feedback_data or [])
        if getattr(getattr(f, "category", None), "value", None) == "SHOULD_DO"
        and (f.score or 0) > 0
        and f.behavior_instruction_id
    ]

    return {
        "next_instruction": next_instruction,
        "feedback_to_send": feedback_to_send,
        "advancing_behaviour_ids": advancing_behaviour_ids,
    }


async def _detect_single_behavior_instruction(
    behavior_instruction: SimulationBehaviorInstruction,
    chat_messages: list,
    prompt_data: Optional[Any] = None,
) -> Optional[BehaviorInstructionFeedbackData]:
    """
    Detect a single behavior instruction by delegating to its detect method.

    Follows the same pattern as detect_single_event in _detect_events:
    the model owns its detection logic (like BaseEvent.detect_event).

    Args:
        behavior_instruction: The behavior instruction to detect
        chat_messages: Conversation messages (ChatMessage format)

    Returns:
        BehaviorInstructionFeedbackData if detected, None otherwise
    """
    try:
        detected = await behavior_instruction.detect(
            chat_messages, prompt_data=prompt_data
        )
        if detected:
            return BehaviorInstructionFeedbackData(
                behavior_instruction_id=behavior_instruction.behavior_instruction_id,
                score=behavior_instruction.score,
                category=behavior_instruction.category,
            )
    except Exception as e:
        logger.exception(
            f"Behavior instruction detection failed for "
            f"{behavior_instruction.behavior_instruction_id}: {e}"
        )

    return None


async def _detect_behavior_instructions(
    behavior_instructions: list[SimulationBehaviorInstruction] | None,
    chat_messages: list,
    prompt_data: Optional[Any] = None,
) -> list[BehaviorInstructionFeedbackData]:
    """
    Detect all behavior instructions in parallel.

    Similar to _detect_events, all behavior instructions are evaluated
    concurrently for optimal performance.

    Args:
        behavior_instructions: List of behavior instructions from scenario
        chat_messages: Conversation messages (ChatMessage format)

    Returns:
        List of BehaviorInstructionFeedbackData for detected behaviors
    """
    if not behavior_instructions:
        return []

    concurrency_limit = max(1, settings.EVENT_DETECTION_CONCURRENCY_LIMIT)
    semaphore = asyncio.Semaphore(concurrency_limit)

    async def detect_with_timeout(
        bi: SimulationBehaviorInstruction,
    ) -> Optional[BehaviorInstructionFeedbackData]:
        _start = datetime.now(timezone.utc)
        outcome = "false"
        try:
            async with semaphore:
                result = await asyncio.wait_for(
                    _detect_single_behavior_instruction(
                        bi, chat_messages, prompt_data=prompt_data
                    ),
                    timeout=10.0,
                )
                outcome = "true" if result else "false"
                return result
        except asyncio.TimeoutError:
            outcome = "timeout"
            logger.warning(
                f"Behavior instruction {bi.behavior_instruction_id or ''} "
                f"detection timed out after 10s, skipping"
            )
            return None
        finally:
            # Per-behavior timing for deep dives — DEBUG, out of prod INFO.
            _ms = (datetime.now(timezone.utc) - _start).total_seconds() * 1000
            logger.debug(
                "[BEHAVIOR_TIMING] behavior_id=%s latency_ms=%.1f detected=%s",
                getattr(bi, "behavior_instruction_id", "") or "?",
                _ms,
                outcome,
            )

    detection_tasks = [
        asyncio.create_task(detect_with_timeout(bi)) for bi in behavior_instructions
    ]

    results = []
    if detection_tasks:
        logger.debug(
            f"Detecting {len(detection_tasks)} behavior instructions in parallel"
        )
        for t in asyncio.as_completed(detection_tasks):
            result = await t
            if result is not None:
                results.append(result)

    logger.info(
        f"Behavior detection complete: {len(results)}/{len(behavior_instructions)} "
        f"detected"
    )
    return results


@instrumented_node("detect_behaviors")
async def detect_behaviors(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Detect behaviors from behavior instructions based on conversation.

    This node runs in parallel with generate_response. It evaluates the
    conversation against the scenario's behavior instructions and produces
    BehaviorInstructionFeedbackData entries for each detected behavior.

    The results are stored in state and later:
    - Sent to UI with score updates (empty emoji and feedback message)
    - Sent to BE as behavior_instruction type (distinct from event type)

    Detected behavior scores are also accumulated in ScoreKeeper (if present
    in config) so they are included in the final score sent to core.
    """
    logger.info("Detecting behaviors")

    # Pause gate: skip behavior detection/scoring while the session is paused.
    if config and "configurable" in config:
        _clock = config["configurable"].get("session_clock")
        if _clock is not None and _clock.is_paused:
            logger.info("[PAUSE] detect_behaviors skipped — session paused")
            return {"behavior_feedback_data": []}

    if settings.BEHAVIORS_DEFER_DETECTION:
        # BEHAVIORS_OFF_GATE already keeps this node off the reply's critical
        # path, but send_event_feedback (or sync_events_and_behaviors_node)
        # still waits for THIS node to return — a graph "parallel" edge is
        # not the same as actually detached (see the superstep-barrier
        # history on EVENTS_OFF_GATE_DEFER_DETECTION). Spawning the real work
        # as a genuinely detached task and returning empty immediately means
        # whichever node this feeds into waits on a near-instant node
        # instead. See _run_deferred_behaviors and BEHAVIORS_DEFER_DETECTION.
        orchestrator = (
            config["configurable"].get("event_orchestrator")
            if config and "configurable" in config
            else None
        )
        if orchestrator is not None:
            orchestrator._spawn_background(
                _run_deferred_behaviors(state, config, orchestrator),
                label="process_deferred_behaviors",
            )
        return {"behavior_feedback_data": []}

    # Get scenario and score_keeper from config
    scenario = None
    score_keeper: Optional[ScoreKeeper] = None
    if config and "configurable" in config:
        scenario = config["configurable"].get("scenario")
        score_keeper = config["configurable"].get("score_keeper")

    if not scenario or not getattr(scenario, "behavior_instructions", None):
        logger.debug("No behavior instructions configured, skipping detection")
        return {"behavior_feedback_data": []}

    # Prepare conversation messages
    chat_messages = convert_messages_to_chat_messages(state.messages)

    if not chat_messages:
        logger.debug("No conversation messages, skipping behavior detection")
        return {"behavior_feedback_data": []}

    # Detect all behavior instructions in parallel.
    # Node-level ceiling: per-behavior timeout is 10s, but with many behaviors
    # queued behind the semaphore the node can run far longer. 15s covers two
    # full batches of 8 concurrent behaviors; beyond that we return what we
    # have so the fan-in sync node can unblock.
    try:
        behavior_feedback = await asyncio.wait_for(
            _detect_behavior_instructions(
                scenario.behavior_instructions,
                chat_messages,
                prompt_data=scenario.prompt_data,
            ),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[detect_behaviors] node timed out after 15s — "
            "returning empty behavior feedback so fan-in can proceed"
        )
        behavior_feedback = []

    # Accumulate behavior scores in ScoreKeeper
    if score_keeper and behavior_feedback:
        log_side_effect(
            "score_keeper_add_behavior",
            count=len(behavior_feedback),
            scores=",".join(str(f.score) for f in behavior_feedback),
        )
        for feedback in behavior_feedback:
            await score_keeper.add_behavior_score(feedback.score)
        logger.info(
            f"ScoreKeeper: accumulated {len(behavior_feedback)} behavior score(s), "
            f"total behavior score = {score_keeper.behavior_score}"
        )

    return {"behavior_feedback_data": behavior_feedback}


async def _send_behavior_feedback_to_be(behavior_feedback_data: list, room) -> None:
    """Send detected behavior feedback to Core over SQS (backend only — UI
    is handled separately by the caller).

    Pure extraction of send_event_feedback's original inline loop, unchanged
    logic — callable from both the synchronous path (send_event_feedback)
    and the BEHAVIORS_DEFER_DETECTION background-task path
    (_run_deferred_behaviors) without duplicating it.
    """
    if not behavior_feedback_data:
        return
    if room is None:
        logger.warning("No room available, skipping behavior feedback sending")
        return

    logger.info(
        f"Sending {len(behavior_feedback_data)} behavior feedback entries to BE"
    )
    log_side_effect(
        "sqs_behavior_feedback_send",
        count=len(behavior_feedback_data),
    )
    for bf_data in behavior_feedback_data:
        behavior_data = {
            "behaviorInstructionId": bf_data.behavior_instruction_id,
            "score": bf_data.score,
            "category": bf_data.category.value,
        }
        core_behavior_message = CoreEventMessageType.create_behavior_instruction(
            room_id=room.name,
            behavior_instruction_data=behavior_data,
        )
        await msg_event_queue.send_message(
            message_body=core_behavior_message.model_dump_json()
        )

    logger.info("Behavior feedback sent to BE successfully")


async def _send_deferred_behavior_ui_feedback(
    behavior_feedback_data: list, room
) -> None:
    """Send a standalone UI score update for deferred (off-gate) behaviors.

    Mirrors _send_deferred_ui_feedback's pattern, but behaviors have no
    message/emoji of their own — send_event_feedback's synchronous path
    already treats this as "no feedback selected, but still send the
    score" (see its own fallback branch); this is the same shape, just
    scoped to behaviors and delivered independently. See
    BEHAVIORS_DEFER_DETECTION.
    """
    if room is None or not behavior_feedback_data:
        return
    cumulative_score = sum(bf.score for bf in behavior_feedback_data)
    detected_event_ids = [bf.behavior_instruction_id for bf in behavior_feedback_data]
    ui_message = CustomUIEventMessageType.create(
        score=cumulative_score,
        emoji=None,
        message="",
        timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ"),
        show_feedback=True,
        detected_event_ids=detected_event_ids,
    )
    log_side_effect(
        "ui_publish_score_deferred_behaviors",
        cumulative_score=cumulative_score,
        behavior_count=len(behavior_feedback_data),
    )
    await send_event_to_ui(ui_message, room)


async def _run_deferred_behaviors(
    state: SimulationState, config: Optional[RunnableConfig], orchestrator
) -> None:
    """Off-gate detection + delivery for behavior instructions.

    Spawned as a genuinely DETACHED background task from detect_behaviors
    (via orchestrator._spawn_background), not a graph node — mirrors
    _run_deferred_events exactly and for the same reason: send_event_feedback
    has two incoming edges and LangGraph waits for both before firing it, so
    a "parallel" graph edge alone does not stop it from being held up by
    however long this takes. Being outside the graph entirely means it
    cannot participate in any superstep. See BEHAVIORS_DEFER_DETECTION.
    """
    # Pause gate (mirror detect_behaviors): the background task can outlive
    # a pause-state change that happens mid-flight.
    if config and "configurable" in config:
        _clock = config["configurable"].get("session_clock")
        if _clock is not None and _clock.is_paused:
            return

    scenario = None
    score_keeper: Optional[ScoreKeeper] = None
    room = None
    if config and "configurable" in config:
        scenario = config["configurable"].get("scenario")
        score_keeper = config["configurable"].get("score_keeper")
        room = config["configurable"].get("room")

    if not scenario or not getattr(scenario, "behavior_instructions", None):
        return

    chat_messages = convert_messages_to_chat_messages(state.messages)
    if not chat_messages:
        return

    _start = datetime.now(timezone.utc)
    try:
        behavior_feedback = await asyncio.wait_for(
            _detect_behavior_instructions(
                scenario.behavior_instructions,
                chat_messages,
                prompt_data=scenario.prompt_data,
            ),
            timeout=15.0,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[BEHAVIORS_DEFER_DETECTION] deferred behavior detection timed "
            "out after 15s"
        )
        return
    finally:
        _ms = (datetime.now(timezone.utc) - _start).total_seconds() * 1000
        logger.debug("[BEHAVIOR_TIMING] deferred node latency_ms=%.1f", _ms)

    if not behavior_feedback:
        return

    if score_keeper:
        for feedback in behavior_feedback:
            await score_keeper.add_behavior_score(feedback.score)
        logger.info(
            f"ScoreKeeper: accumulated {len(behavior_feedback)} deferred "
            f"behavior score(s), total behavior score = "
            f"{score_keeper.behavior_score}"
        )

    await _send_behavior_feedback_to_be(behavior_feedback, room)
    await _send_deferred_behavior_ui_feedback(behavior_feedback, room)


def _trim_history_to_last_dialogues(messages: list, max_dialogues: int) -> list:
    """Keep only the last ``max_dialogues`` learner turns (and everything after
    the earliest kept turn) of the dialogue history.

    A "dialogue" is anchored on a HumanMessage (a learner turn). We slice from
    the ``max_dialogues``-th-last HumanMessage so the window always starts on a
    learner turn and includes its reply(ies). Older messages are dropped — the
    persona/scenario/RAG context is NOT here (it's in the system prompt), so
    nothing essential is lost; this only shortens the prompt to cut latency.

    Returns ``messages`` unchanged when trimming is disabled (max_dialogues<=0)
    or the conversation hasn't exceeded the window yet.
    """
    if max_dialogues <= 0:
        return messages
    human_indices = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
    if len(human_indices) <= max_dialogues:
        return messages
    start = human_indices[-max_dialogues]
    return messages[start:]


@instrumented_node("generate_response")
async def generate_response(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Generate LLM response based on detected events and branching instruction.

    This function:
    1. Uses resolved branching instruction from state (resolved in previous node)
    2. Generates LLM response using the branching instruction (if any)
    3. Returns the AI message and clears consumed fields

    Feedback sending to UI is handled separately by ``send_event_feedback``,
    which runs as a dedicated node at the end of the agent graph. This
    separation keeps generate_response reusable for contexts that don't
    need UI feedback (e.g. report generation).
    """
    logger.info("Generating response")

    # Get score_keeper at the start for accurate score tracking
    score_keeper = None
    if config and "configurable" in config:
        score_keeper = config["configurable"].get("score_keeper")

    # Rolling-summary store (episodic memory), worker-owned — see
    # RollingSummaryStore. Absent in the report graph and when the feature is
    # off. Snapshot summary+boundary ONCE so the prompt block and the history
    # slice below stay consistent even if a background compaction lands
    # mid-turn.
    _rs_summary: Optional[str] = None
    _rs_covered = 0
    if settings.ROLLING_SUMMARY_ENABLED and config and "configurable" in config:
        _rs_store = config["configurable"].get("rolling_summary_store")
        if _rs_store is not None and _rs_store.summary:
            _rs_summary = _rs_store.summary
            _rs_covered = max(0, _rs_store.covered_count)

    # Client working memory: open the turn BEFORE the reply is generated.
    #
    # This is a store mutation, not a state write, for the reason recorded on
    # SimulationState about the rolling summary and the retrieval countdown: a
    # barge-in-cancelled superstep discards state writes that never survived a
    # checkpoint commit, and a turn counter that silently un-increments would
    # make the monotonic commit check meaningless.
    #
    # It belongs here rather than in a node of its own because "before the
    # reply" is the whole contract — putting it in a separate superstep buys a
    # barrier on the voice-to-voice path and an ordering that a later edge could
    # get wrong. begin_turn is a lock, an increment and a deepcopy; it does no
    # I/O.
    #
    # If the reply is then cancelled mid-stream the increment still stands, and
    # that is correct: the turn happened. The update for it may never run, which
    # costs one turn of observations and is why the updater reads a WINDOW of
    # recent messages rather than a strict delta.
    # Gated on the scenario's OPT-IN, which is now the ONLY gate: the opt-in is
    # the `{client_working_memory}` placeholder — or any working_memory_*
    # section placeholder — in the selected main-agent prompt's body
    # (design §6.1). A simulation that has not opted in must not pay for a
    # consolidation call whose output nothing would render, so the turn is not
    # even opened for it — which is what makes this safe to run unconditionally
    # for every existing simulation.
    _cwm_memory = None
    if config and "configurable" in config:
        _cwm_store = config["configurable"].get("client_working_memory_store")
        _cwm_scenario = config["configurable"].get("scenario")
        _cwm_prompt_data = (
            getattr(_cwm_scenario, "prompt_data", None) if _cwm_scenario else None
        )
        if _cwm_store is not None and (
            _cwm_prompt_data is not None
            and prompt_declares_client_working_memory(_cwm_prompt_data)
        ):
            _cwm_memory = await _cwm_store.begin_turn()

    # Use resolved branching instruction from state
    next_instruction = state.next_instruction

    # Build system message from scenario and prepend only for the LLM call
    scenario = (
        cast(Scenario, config["configurable"].get("scenario")) if config else None
    )

    # ElevenLabs v3 supports inline audio tags ([pause], [sighs], [empathetic],
    # ...). When the scenario's TTS provider supports them, fold the tag guidance
    # into the persona prompt so the agent emits tags inline as it generates —
    # letting tokens stream straight to TTS (STREAM_RESPONSE). The guidance TEXT
    # is resolved from prompt management
    # (code `ally_ai_learn_system_audio_tag_guidance`, local fallback
    # `app/prompts/system/audio_tag_guidance.txt`): dashboard override wins, else
    # the local .txt. Stays None for v2 ElevenLabs and every non-tag provider,
    # leaving the prompt unchanged.
    tts_client = (
        config["configurable"].get("tts_client")
        if config and "configurable" in config
        else None
    )
    audio_tag_instructions = None
    if tts_client is not None:
        try:
            if tts_client.supports_text_enhancement():
                audio_tag_instructions = (
                    load_template(
                        "system/audio_tag_guidance",
                        scenario.prompt_data if scenario is not None else None,
                    )
                    or None
                )
                if not audio_tag_instructions:
                    # Provider supports tags but guidance resolved empty (missing
                    # local .txt / empty dashboard override). Don't fail the turn,
                    # but warn — v3 would otherwise speak tag-less with no signal.
                    logger.warning(
                        "[generate_response] audio tag guidance empty for "
                        "tag-capable provider; emitting reply without inline tags"
                    )
        except Exception:
            logger.exception(
                "[generate_response] failed to resolve audio tag guidance; "
                "emitting reply without inline tags"
            )
            audio_tag_instructions = None

    # Text-chat roleplay: the main-agent prompts are written for a call, so a
    # TEXT session appends guidance on writing as a person texting a helpline.
    # Resolved from prompt management (code
    # `ally_ai_learn_system_text_chat_guidance`, local fallback
    # `app/prompts/system/text_chat_guidance.txt`): a dashboard override wins.
    # Always None for a voice session, leaving its prompt unchanged.
    text_chat_guidance = None
    if scenario is not None and getattr(scenario, "is_text_chat", False):
        try:
            text_chat_guidance = (
                load_template("system/text_chat_guidance", scenario.prompt_data) or None
            )
            if not text_chat_guidance:
                logger.warning(
                    "[generate_response] text chat guidance resolved empty; "
                    "the persona will write in its voice-call style"
                )
        except Exception:
            logger.exception(
                "[generate_response] failed to resolve text chat guidance; "
                "the persona will write in its voice-call style"
            )
            text_chat_guidance = None

    # Get language code
    language_code = DEFAULT_LANGUAGE_CODE
    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code
        logger.info(f"Using language code '{language_code}' from scenario")
    else:
        logger.info(f"Using default language code '{language_code}'")

    system_message = None
    retrieved_context_message = None
    current_state = None
    if scenario is not None:
        # Log prompt mode for observability
        if not next_instruction:
            # Resolve current state for behavior/default modes using ScoreKeeper
            current_score = score_keeper.get_total_score() if score_keeper else 0

            current_state = _resolve_current_state(
                scenario.state_instructions, current_score
            )

        # Let generate_system_message handle routing based on parameters.
        # current_score is forwarded so main-agent variants with hasStates
        # can resolve the active simulation state per turn. score_keeper
        # tracks the cumulative session score (events + behaviors, see
        # app/core/scoring/score_keeper.py); .get_total_score() returns an
        # int (starts at 0 — never None). Passed as None only when no
        # score_keeper has been wired up (test fixtures, dev paths) — the
        # state resolver treats None as score 0, so it resolves to the same
        # state turn 1 would.
        turn_score: Optional[int] = (
            score_keeper.get_total_score() if score_keeper else None
        )
        # Locked memories' TITLES, for the working-memory withheld section.
        # Content never comes this way — retrieval already dropped it.
        _locked_memory_topics: List[str] = []
        _ks = getattr(scenario.prompt_data, "knowledge_sources", None)
        if has_memory_locks(_ks):
            _ks_states = getattr(scenario.prompt_data, "states", None)
            _rc = (config or {}).get("configurable", {}).get("retrieved_context_store")
            _, _locked, _ = resolve_memory_locks(
                _ks,
                _ks_states,
                _resolve_state_for_retrieval(_ks_states, turn_score),
                getattr(_rc, "unlocks", None),
            )
            _locked_memory_topics = locked_memory_topics(_locked)
        # Stage Director prompts: every unlocked memory, every turn, and the
        # director's latest paragraph (docs/stage-director-and-memories.md).
        _sd_thoughts: Optional[str] = None
        _sd_memories: Optional[str] = None
        _sd_sink: Optional[dict] = None
        if prompt_declares_stage_director(scenario.prompt_data):
            from app.core.stage_director.director import NO_THOUGHT_YET
            from app.core.stage_director.memories import (
                partition_for_turn,
                render_memory_block,
            )

            _sd_configurable = (config or {}).get("configurable", {})
            _sd_unlocked, _sd_locked = partition_for_turn(
                scenario.prompt_data,
                _resolve_state_for_retrieval(
                    getattr(scenario.prompt_data, "states", None), turn_score
                ),
                getattr(
                    _sd_configurable.get("retrieved_context_store"), "unlocks", None
                ),
            )
            _sd_memories = render_memory_block(_sd_unlocked, _sd_locked)
            _sd_store = _sd_configurable.get("stage_director_store")
            if _sd_store is not None:
                _sd_store.begin_turn()
                _sd_thoughts = _sd_store.thought_for_prompt()
                _sd_sink = _sd_store.prompt_kwargs
            else:
                _sd_thoughts = NO_THOUGHT_YET
        system_message, retrieved_context_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
            language_code=language_code,
            behavior_instructions=scenario.behavior_instructions,
            current_state=current_state,
            retrieved_context=state.retrieved_context,
            current_score=turn_score,
            audio_tag_instructions=audio_tag_instructions,
            rolling_summary=_rs_summary,
            defer_retrieved_context=settings.RETRIEVED_CONTEXT_DEFER_TO_SUFFIX,
            client_working_memory=_cwm_memory,
            locked_memory_topics=_locked_memory_topics,
            text_chat_guidance=text_chat_guidance,
            thoughts=_sd_thoughts,
            memories=_sd_memories,
            prompt_kwargs_sink=_sd_sink,
        )

        room_name = ""
        if config and "configurable" in config:
            room = config["configurable"].get("room")
            if room and hasattr(room, "name"):
                room_name = room.name
        logger.info(
            "[SIMULATION_PROMPT] room=%s language_code=%s prompt_built mode=%s",
            room_name or "unknown",
            language_code or "None",
            "branching" if next_instruction else "behavior",
        )

        # ---- per-turn simulation state, for the progression metrics ----------
        #
        # States are score-windowed: `_resolve_current_state` picks the state
        # whose (scoreLower, scoreUpper) window contains the cumulative score,
        # so the state a turn ran in is a function of the score at that turn.
        # Stamping it on the turn record makes progression derivable in SQL
        # without a second event stream:
        #
        #   - state advanced      -> state differs from the previous turn's
        #   - time-in-state       -> consecutive turns sharing a state
        #   - stuck               -> no change across N turns
        #   - resolution reached  -> final turn sat in the terminal state
        #
        # `stateIndex` / `stateCount` are carried too, because "state 3 of 3"
        # is what distinguishes arriving at the end from merely moving: the
        # ids are author-defined strings and their order is not inferable
        # downstream.
        try:
            _states = list(getattr(scenario, "state_instructions", None) or [])
            if _states:
                _state_meta: dict = {
                    "stateCount": len(_states),
                    "stateScore": (
                        score_keeper.get_total_score() if score_keeper else None
                    ),
                }
                if current_state is not None:
                    _state_meta["stateId"] = current_state.state_id
                    _state_meta["stateIndex"] = next(
                        (
                            i
                            for i, si in enumerate(_states)
                            if si.state_id == current_state.state_id
                        ),
                        None,
                    )
                    _state_meta["stateIsTerminal"] = (
                        _state_meta["stateIndex"] == len(_states) - 1
                    )
                else:
                    # Branching mode resolves no scored state; recorded as an
                    # explicit null rather than omitted, so "no state this turn"
                    # is distinguishable from "this build did not report state".
                    _state_meta["stateId"] = None
                turn_metrics.record(get_room_id(), metadata=_state_meta)
        except Exception:  # noqa: BLE001 - metrics must never break a turn
            logger.exception("[turn-metrics] failed to record simulation state")

    # Get LLM client from config (pre-configured in AgentSetup) or create dynamically
    llm_client = None
    if config and "configurable" in config:
        llm_client = config["configurable"].get("llm_client")

    # Fallback: Create LLM client dynamically if not provided (backward compatibility)
    if llm_client is None:
        llm_config_from_metadata = None
        if scenario and scenario.language_config:
            llm_config_from_metadata = scenario.language_config.llm_config

        # Honor the roleplay-level temperature override on this fallback path too,
        # so a dynamically-created client matches configure_llm_client's behavior.
        roleplay_temperature = (
            getattr(scenario.prompt_data, "temperature", None) if scenario else None
        )

        try:
            llm_client = create_llm_client(
                llm_config=llm_config_from_metadata,
                language_code=language_code,
                temperature=roleplay_temperature,
            )
        except Exception as e:
            logger.warning(f"LLM config failed for {language_code}, using default: {e}")
            llm_client = create_llm_client(
                language_code=DEFAULT_LANGUAGE_CODE,
                temperature=roleplay_temperature,
            )

    # Prepare the messages for the LLM call without mutating the state. When the
    # scenario opts in (Studio "Trim History" toggle) and the global kill-switch
    # is on, send only the last N exchanges to bound input tokens / latency. The
    # system prompt carries the persona/scenario/RAG context, so trimming only
    # drops the literal wording of older turns.
    history = state.messages
    # Rolling summary (episodic memory): messages already folded into the
    # summary are dropped from the verbatim history — their content reaches the
    # LLM via the summary block appended to the system prompt instead. Unlike
    # plain trimming below, nothing is lost. The summary SUPERSEDES trimming:
    # the verbatim window must be exactly messages[covered:], because a
    # narrower trim window would drop turns that are not yet in the summary
    # (the boundary only advances at compaction time). The window self-bounds
    # between ROLLING_SUMMARY_TAIL_DIALOGUES and tail+ROLLING_SUMMARY_EVERY_TURNS
    # learner turns, so trim's job (bounding input tokens) is already done.
    summary_slice_applied = False
    if _rs_summary and 0 < _rs_covered <= len(history):
        logger.info(
            "[ROLLING_SUMMARY] sending %d/%d verbatim messages (summary covers "
            "the first %d)",
            len(history) - _rs_covered,
            len(history),
            _rs_covered,
        )
        history = history[_rs_covered:]
        summary_slice_applied = True
        # EMERGENCY bound: if compaction stalls (summarizer outage/timeouts)
        # the covered boundary stops advancing and this window would grow
        # without bound — trim no longer catches it since the summary
        # supersedes it. Past the char ceiling, mechanically trim and say so
        # loudly: these turns are dropped WITHOUT summary coverage (bounded,
        # observable degradation instead of quiet latency growth).
        _emergency_chars = settings.ROLLING_SUMMARY_EMERGENCY_WINDOW_CHARS
        if _emergency_chars > 0:
            _window_chars = sum(
                len(str(getattr(m, "content", "") or "")) for m in history
            )
            if _window_chars > _emergency_chars:
                _emergency_keep = (
                    settings.ROLLING_SUMMARY_TAIL_DIALOGUES
                    + settings.ROLLING_SUMMARY_EVERY_TURNS
                )
                _trimmed = _trim_history_to_last_dialogues(history, _emergency_keep)
                if len(_trimmed) < len(history):
                    logger.warning(
                        "[ROLLING_SUMMARY] EMERGENCY trim %d -> %d messages "
                        "(window %d chars > %d): compaction is not keeping up; "
                        "%d messages dropped WITHOUT summary coverage",
                        len(history),
                        len(_trimmed),
                        _window_chars,
                        _emergency_chars,
                        len(history) - len(_trimmed),
                    )
                    history = _trimmed
    scenario_trim_on = bool(
        getattr(getattr(scenario, "prompt_data", None), "history_trim_enabled", False)
    )
    if (
        not summary_slice_applied
        and settings.HISTORY_TRIM_ENABLED
        and scenario_trim_on
        and settings.HISTORY_TRIM_DIALOGUES > 0
    ):
        trimmed = _trim_history_to_last_dialogues(
            history, settings.HISTORY_TRIM_DIALOGUES
        )
        if len(trimmed) != len(history):
            logger.info(
                "[generate_response] history trimmed %d -> %d messages "
                "(last %d dialogues)",
                len(history),
                len(trimmed),
                settings.HISTORY_TRIM_DIALOGUES,
            )
        history = trimmed

    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(history)
    if retrieved_context_message is not None:
        messages_to_send.append(retrieved_context_message)
    # What the learner has ALREADY heard this turn (a catalog opener, a bridge
    # line). Last, so it is the freshest instruction the model reads, and after
    # everything cacheable so it never moves the cached prefix. See
    # TurnDelivery.reply_note: without it the reply opened with its own "um" /
    # "[long pause]" right after the opener in 19 of 43 sampled prod turns.
    _opener_note = _delivery_reply_note(config)
    if _opener_note:
        messages_to_send.append(SystemMessage(content=_opener_note))

    # Get LLM instance
    llm_instance = llm_client.llm_instance

    # Generate response - no tools, just generate response text.
    # Wrapped in asyncio.wait_for so a hanging upstream LLM (OpenAI/Gemini)
    # cannot block the agent in "thinking" state indefinitely. See
    # LLM_RESPONSE_TIMEOUT in app/core/config.py.
    llm_model_name = (
        getattr(llm_instance, "model_name", None)
        or getattr(llm_instance, "model", None)
        or "unknown"
    )
    # Generation config captured for drift-analytics attribution (provider /
    # params that produced this turn). Read defensively off the client/instance.
    _gen_config = {
        "llm_provider": getattr(llm_client, "provider", None),
        "temperature": getattr(llm_instance, "temperature", None),
        "top_p": getattr(llm_instance, "top_p", None),
        "max_tokens": (
            getattr(llm_instance, "max_tokens", None)
            or getattr(llm_instance, "max_output_tokens", None)
        ),
    }
    # Prompt-composition breakdown for A/B-ing the rolling summary (episodic
    # memory) against the full-history baseline. One line per turn — grep
    # "[PROMPT_SIZE]" and compare system/history chars, verbatim message
    # count and summary size across runs; pair with "[PROMPT_CACHE]" (token
    # cache hits) and llm_call_complete latency_s for the full picture.
    _system_chars = len(system_message.content) if system_message is not None else 0
    _history_chars = sum(len(str(getattr(m, "content", "") or "")) for m in history)
    _trailing_chars = (
        len(retrieved_context_message.content)
        if retrieved_context_message is not None
        else 0
    )
    _summary_active = bool(_rs_summary)
    logger.info(
        "[PROMPT_SIZE] room=%s mode=%s summary_active=%s summary_chars=%d "
        "system_chars=%d history_msgs=%d/%d history_chars=%d trailing_chars=%d "
        "total_chars=%d",
        get_room_id(),
        "branching" if next_instruction else "behavior",
        _summary_active,
        len(_rs_summary or ""),
        _system_chars,
        len(history),
        len(state.messages),
        _history_chars,
        _trailing_chars,
        _system_chars + _history_chars + _trailing_chars,
    )
    _llm_start = datetime.now(timezone.utc)
    logger.info(
        "[generate_response] llm_call_start model=%s timeout=%ss messages=%d",
        llm_model_name,
        settings.LLM_RESPONSE_TIMEOUT,
        len(messages_to_send),
    )
    try:
        response = await asyncio.wait_for(
            llm_instance.ainvoke(messages_to_send),
            timeout=settings.LLM_RESPONSE_TIMEOUT,
        )
        _llm_latency = (datetime.now(timezone.utc) - _llm_start).total_seconds()
        logger.info(
            "[generate_response] llm_call_complete model=%s latency_s=%.2f "
            "content_chars=%d",
            llm_model_name,
            _llm_latency,
            len(getattr(response, "content", "") or ""),
        )
        turn_metrics.record(
            get_room_id(),
            llm_response_ms=int(_llm_latency * 1000),
            response_chars=len(getattr(response, "content", "") or ""),
            llm_model=llm_model_name,
            language=language_code or DEFAULT_LANGUAGE_CODE,
            invocation_id=get_invocation_id(),
            **_gen_config,
        )
        # Best-effort token-usage emission for the cost-by-model/task dashboard.
        # Never affects the turn (emitter swallows all errors). Skipped on the
        # timeout fallback below, where no real usage exists.
        try:
            from app.core.llm_usage.emitter import emit_llm_usage
            from app.core.llm_usage.extract import extract_usage_from_aimessage
            from app.core.llm_usage.tasks import LLMTask

            usage = extract_usage_from_aimessage(response)
            emit_llm_usage(
                room_id=get_room_id(),
                provider=_gen_config.get("llm_provider"),
                model=llm_model_name,
                task=LLMTask.AGENT_TURN.value,
                usage=usage,
            )
            # Direct visibility into prompt-cache hits without waiting on the
            # BE usage pipeline/dashboard — grep "[PROMPT_CACHE]" on a live
            # session to confirm the reordered templates are actually
            # landing in the provider's cache, not just eligible for it.
            if usage:
                prompt_tokens, _, _, cached_tokens = usage
                hit_rate = (cached_tokens / prompt_tokens) if prompt_tokens else 0.0
                logger.info(
                    "[PROMPT_CACHE] room=%s model=%s prompt_tokens=%d "
                    "cached_tokens=%d hit_rate=%.0f%%",
                    get_room_id(),
                    llm_model_name,
                    prompt_tokens,
                    cached_tokens,
                    hit_rate * 100,
                )
                # Persisted alongside the log line so cache-hit-rate can be
                # charted platform-wide (Latency & Reliability tab) instead of
                # only ever being visible via a one-room-at-a-time log query.
                turn_metrics.record(
                    get_room_id(),
                    prompt_tokens=prompt_tokens,
                    cached_tokens=cached_tokens,
                )
        except Exception:
            pass
    except asyncio.TimeoutError:
        _llm_latency = (datetime.now(timezone.utc) - _llm_start).total_seconds()
        logger.error(
            "[generate_response] llm_call_timeout room=%s model=%s latency_s=%.2f "
            "timeout=%ss — returning safe fallback message",
            get_room_id(),
            llm_model_name,
            _llm_latency,
            settings.LLM_RESPONSE_TIMEOUT,
        )
        turn_metrics.record(
            get_room_id(),
            llm_response_ms=int(_llm_latency * 1000),
            llm_model=llm_model_name,
            language=language_code or DEFAULT_LANGUAGE_CODE,
            llm_timed_out=True,
            invocation_id=get_invocation_id(),
            **_gen_config,
        )
        # Resolve the fallback line from the session's language rather than
        # always speaking English at a Hindi/Tamil/Telugu/Marathi learner (the
        # Indic voices also spell Latin script out letter-by-letter). English
        # is the default for any language without a translation yet, so this is
        # never worse than the previous hardcoded line. See
        # app/core/fallback_lines.py for the table and the TODO(i18n) list.
        from app.core.fallback_lines import llm_timeout_fallback_line

        _fallback_line = llm_timeout_fallback_line(language_code)
        logger.info(
            "[generate_response] llm_timeout_fallback room=%s language=%s",
            get_room_id(),
            language_code or DEFAULT_LANGUAGE_CODE,
        )
        response = AIMessage(content=_fallback_line)
    except Exception as e:
        _llm_latency = (datetime.now(timezone.utc) - _llm_start).total_seconds()
        logger.exception(
            "[generate_response] llm_call_failed model=%s latency_s=%.2f error=%s",
            llm_model_name,
            _llm_latency,
            str(e),
        )
        raise

    # Log interaction for evaluation if logging is enabled
    if settings.EVALUATION_LOGGING_ENABLED:
        try:
            from app.evaluation.logger import evaluation_logger

            # Get session/room ID from config
            session_id = None
            if config and "configurable" in config:
                room = config["configurable"].get("room")
                if room and hasattr(room, "name"):
                    session_id = room.name

            # Get last user message
            last_user_message = None
            for msg in reversed(state.messages):
                if isinstance(msg, HumanMessage) and hasattr(msg, "content"):
                    last_user_message = msg.content
                    break

            if last_user_message:
                # Ensure language_code is a string (fallback to default if None)
                safe_language_code = (
                    language_code
                    if isinstance(language_code, str) and language_code
                    else DEFAULT_LANGUAGE_CODE
                )

                evaluation_logger.log_interaction(
                    input_text=last_user_message,
                    output_text=response.content,
                    language_code=safe_language_code,
                    metadata={
                        "scenario_id": scenario.name if scenario else None,
                        "model": getattr(llm_instance, "model_name", None)
                        or getattr(llm_instance, "model", None),
                    },
                    session_id=session_id,  # Pass session_id for conversation tracking
                )
        except Exception as e:
            logger.warning(f"Failed to log interaction for evaluation: {e}")

    # Stash the just-generated utterance on the shared session clock so a pause
    # can re-speak it on resume (in-process; same event loop as the worker).
    # The spoken reply had the glossary's word swaps applied as it streamed
    # (GlossarySwapAgent.llm_node). Apply the same swaps to what the graph
    # REMEMBERS, or the actor's own history keeps the literary form and
    # re-teaches it on every following turn; the pause re-speak line must also
    # match what the counsellor heard.
    final_content = response.content
    if config and "configurable" in config:
        final_content = swap_complete_text(
            swap_table_for(config["configurable"].get("scenario")),
            _trim_after_opener(
                config["configurable"].get("turn_delivery"), response.content
            ),
        )
        _clock = config["configurable"].get("session_clock")
        if _clock is not None:
            _clock.last_agent_utterance = final_content

    # NOTE: retrieved_context is deliberately NOT cleared here. The
    # refresh-cadence reuse in retrieve_knowledge re-injects
    # state.retrieved_context on off-cadence turns — clearing it after every
    # reply (a leftover from before the cadence feature) made those turns
    # re-inject an already-wiped None, so the persona LOST its knowledge
    # context on every other turn and the system prompt flip-flopped ~700
    # chars turn-to-turn (observed live: alternating prompt-cache misses).
    # retrieve_knowledge owns the context lifecycle now: it recomputes,
    # reuses, or returns None on its disabled/error paths every turn.
    return {
        "messages": [AIMessage(content=final_content)],
        "new_events": [],
        "next_instruction": None,
    }


@instrumented_node("send_event_feedback")
async def send_event_feedback(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Send all feedback (events + behaviors) to UI after LLM response generation.

    This node is placed at the end of the agent graph (after
    generate_response) and is NOT used by the report graph.

    It:
    1. Merges feedback from branching and non-branching events:
       - Priority 1: Branching event feedback (from resolve_branching_instruction)
       - Priority 2: Highest score non-branching event feedback
    2. Calculates cumulative score from all active events
    3. Sends the combined score + feedback to the UI
    4. Sends detected behavior feedback to UI and BE
    5. Clears transient event/feedback/behavior state after processing
    """
    feedback_to_send = state.feedback_to_send

    # Merge feedback selection: Priority 1 = branching, Priority 2 = non-branching
    if (
        not feedback_to_send
        and state.non_branching_feedback_data
        and settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS
    ):
        events_with_feedback = [
            ed for ed in state.non_branching_feedback_data if ed.feedback is not None
        ]
        if events_with_feedback:
            selected_event_data = max(events_with_feedback, key=lambda e: abs(e.score))
            feedback_to_send = selected_event_data.feedback
            logger.info(
                f"Priority 2: Selected highest score non-branching event "
                f"(score={selected_event_data.score}) for UI feedback"
            )

    if config and "configurable" in config:
        room = config["configurable"].get("room")
        if room is not None:
            all_active_events_data = []

            if state.branching_and_feedback_data:
                branching_active = [
                    ed
                    for ed in state.branching_and_feedback_data
                    if ed.feedback is not None
                ]
                all_active_events_data.extend(branching_active)

            if state.non_branching_feedback_data:
                non_branching_active = [
                    ed
                    for ed in state.non_branching_feedback_data
                    if ed.feedback is not None
                ]
                all_active_events_data.extend(non_branching_active)

            logger.info("Calculating cumulative score for UI:")
            branching_count = len(
                [ed for ed in state.branching_and_feedback_data if ed.feedback]
            )
            non_branching_count = len(
                [ed for ed in state.non_branching_feedback_data if ed.feedback]
            )
            behavior_count = (
                len(state.behavior_feedback_data) if state.behavior_feedback_data else 0
            )

            logger.info(
                f"     ACTIVE events count: {len(all_active_events_data)} "
                f"({branching_count} branching + {non_branching_count} non-branching)"
            )
            logger.info(f"     Behavior feedback count: {behavior_count}")

            # Accumulate behavior scores with event scores
            behavior_scores = []
            if state.behavior_feedback_data:
                behavior_scores = [
                    bf_data.score for bf_data in state.behavior_feedback_data
                ]

            # Send combined feedback if there are events OR behaviors
            if all_active_events_data or behavior_scores:
                # Cumulative score: sum of scores from all ACTIVE events + behaviors
                event_scores = [ed.score for ed in all_active_events_data]
                cumulative_score = sum(event_scores) + sum(behavior_scores)

                logger.info(f"     Event scores: {event_scores}")
                logger.info(f"     Behavior scores: {behavior_scores}")
                logger.info(f"     ➜ Cumulative score: {cumulative_score}")

                detected_event_ids = [ed.event_id for ed in all_active_events_data]

                # Handle feedback message - only from events
                # (behaviors don't have messages)
                if feedback_to_send:
                    feedback_message = (
                        feedback_to_send.message
                        if feedback_to_send.message is not None
                        else ""
                    )
                    feedback_emoji = feedback_to_send.emoji
                    show_feedback = feedback_to_send.show_feedback
                else:
                    # No feedback selected, but we still send the score
                    feedback_message = ""
                    feedback_emoji = None
                    show_feedback = True

                # Create UI message with cumulative score (events + behaviors)
                ui_message = CustomUIEventMessageType.create(
                    score=cumulative_score,
                    emoji=feedback_emoji,
                    message=feedback_message,
                    timestamp=datetime.now(timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%S.%fZ"
                    ),
                    show_feedback=show_feedback,
                    detected_event_ids=detected_event_ids,
                )

                logger.info("Sending combined feedback to UI:")
                log_side_effect(
                    "ui_publish_score",
                    cumulative_score=cumulative_score,
                    event_count=len(all_active_events_data),
                    behavior_count=len(behavior_scores),
                )
                await send_event_to_ui(ui_message, room)
                logger.info("UI feedback sent successfully")

    # Send behavior feedback to BE (backend only, UI already handled above)
    if state.behavior_feedback_data:
        room = None
        if config and "configurable" in config:
            room = config["configurable"].get("room")
        await _send_behavior_feedback_to_be(state.behavior_feedback_data, room)

    return {
        "branching_and_feedback_data": None,
        "non_branching_feedback_data": None,
        "feedback_to_send": None,
        "behavior_feedback_data": None,
    }


@instrumented_node("retrieve_knowledge")
async def retrieve_knowledge(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Retrieve relevant knowledge context based on the conversation.

    This node runs in parallel with process_events and detect_behaviors.
    It uses the scenario's knowledge_sources to identify which topics are
    relevant to the current conversation via a structured LLM call, then
    stores the formatted descriptions in state for prompt enrichment.

    Wrapped in a subgraph in the graph builder to prevent its LLM outputs
    from being streamed to TTS/UI.
    """
    scenario = None
    llm_client = None
    if config and "configurable" in config:
        scenario = config["configurable"].get("scenario")
        llm_client = config["configurable"].get("llm_client")

    if not scenario or not llm_client:
        return {"retrieved_context": None}

    knowledge_sources = getattr(scenario.prompt_data, "knowledge_sources", None)
    # Stage Director prompts show every unlocked memory on every turn instead,
    # so their knowledge never goes through the picker. Glossary sections still
    # do.
    if prompt_declares_stage_director(scenario.prompt_data):
        knowledge_sources = None
    # Tier 1 language-glossary sections (LANGUAGE_GLOSSARY_DESIGN.md §5.2):
    # pre-prefixed titles + retrievalHint, shipped by ally-be for non-English
    # sessions with published retrieved-mode sections. They join the same
    # title-selection call as scenario knowledge — no extra LLM call.
    glossary_sections = getattr(scenario.prompt_data, "glossary_sections", None)
    if not knowledge_sources and not glossary_sections:
        # DEBUG: per-turn — most scenarios don't configure knowledge sources.
        logger.debug(
            "[RAG] retrieve_knowledge: no knowledge_sources or glossary "
            "sections; skipping retrieval"
        )
        return {"retrieved_context": None}

    # Trainer-authored memory locks (knowledge_locks.py): a locked source is
    # dropped before the title selector ever sees it, so its content cannot be
    # selected, cached or rendered. Resolved against the scenario's states
    # whatever the selected prompt declares — a lock is the trainer's intent,
    # and fail-closed beats a prompt swap quietly releasing every secret.
    _rc_store_for_locks = (
        (config or {}).get("configurable", {}).get("retrieved_context_store")
    )
    if has_memory_locks(knowledge_sources):
        _lock_score_keeper = (
            config["configurable"].get("score_keeper") if config else None
        )
        _lock_states = getattr(scenario.prompt_data, "states", None)
        _lock_active = _resolve_state_for_retrieval(
            _lock_states,
            _lock_score_keeper.get_total_score() if _lock_score_keeper else None,
        )
        knowledge_sources, _locked_sources, _newly_unlocked = resolve_memory_locks(
            knowledge_sources,
            _lock_states,
            _lock_active,
            getattr(_rc_store_for_locks, "unlocks", None),
        )
        if _newly_unlocked and _rc_store_for_locks is not None:
            # Don't make a memory that just opened up wait out the reuse
            # countdown. The set only grows, so a reused context can never be
            # holding something that is locked now — it can only be missing
            # something that is unlocked now.
            _rc_store_for_locks.turns_until_refresh = 0
        logger.debug(
            "[MEMORY_LOCK] retrieve_knowledge: state=%s unlocked=%d locked=%d",
            _lock_active.get("name") if isinstance(_lock_active, dict) else None,
            len(knowledge_sources),
            len(_locked_sources),
        )

    knowledge_map = build_knowledge_map(knowledge_sources)
    glossary_hints: dict[str, str] = {}
    if isinstance(glossary_sections, list):
        for entry in glossary_sections:
            if not isinstance(entry, dict):
                continue
            title = entry.get("title", "")
            content = entry.get("content", "")
            if title and content:
                knowledge_map[title] = content
                hint = entry.get("retrievalHint", "")
                if hint:
                    glossary_hints[title] = hint
    if not knowledge_map:
        # DEBUG: per-turn — niche edge case (malformed sources).
        logger.debug(
            "[RAG] retrieve_knowledge: knowledge_sources present (n=%d) "
            "but all entries were filtered out (missing title/content); "
            "skipping retrieval",
            len(knowledge_sources) if isinstance(knowledge_sources, list) else 0,
        )
        return {"retrieved_context": None}

    # Per-state RAG gate: if the *selected main-agent prompt* opts into
    # states (hasStates=true) AND the simulation has states defined AND the
    # active state has ragEnabled=false, skip the retrieval LLM call
    # entirely. The prompt builder also blanks {retrieved_context} when
    # ragEnabled is false, but gating here saves the LLM call upstream.
    #
    # Mirror prompt.py:_build_behavior_prompt's check ORDER exactly:
    #   1) selected prompt has hasStates=true
    #   2) simulation has a states array
    #   3) active state resolves
    # so the two paths can't disagree on whether to honor the gate.
    # Dormant `metadata.states` left over from a previous variant
    # selection no longer triggers gating when the current prompt
    # doesn't declare hasStates.
    #
    # Known race: this read of score_keeper runs in parallel with
    # process_events / detect_behaviors which can update the score.
    # The eventual `_build_behavior_prompt` may resolve a different
    # state if the score crosses a boundary mid-turn. Consequence is
    # cosmetic — at worst one wasted LLM call when retrieval ran but
    # the prompt builder ends up blanking retrieved_context for the
    # newer state. State boundaries are 50 apart and per-turn deltas
    # are typically small, so this is rare. See review item B1.
    prompt_has_states = _selected_prompt_has_states_for_retrieval(scenario.prompt_data)
    sim_states = getattr(scenario.prompt_data, "states", None)
    if prompt_has_states and sim_states:
        score_keeper = config["configurable"].get("score_keeper") if config else None
        current_score: Optional[int] = (
            score_keeper.get_total_score() if score_keeper else None
        )
        active_state = _resolve_state_for_retrieval(sim_states, current_score)
        if active_state is not None and active_state.get("ragEnabled") is False:
            # DEBUG: per-turn diagnostic; this fires on every turn for any
            # scenario whose active state has RAG disabled.
            logger.debug(
                "[RAG_GATE] retrieve_knowledge: skipped — active state '%s' (score=%s) "
                "has ragEnabled=false",
                active_state.get("name"),
                current_score,
            )
            return {"retrieved_context": None}
        logger.debug(
            "[RAG_GATE] retrieve_knowledge: proceeding — "
            "state='%s' score=%s ragEnabled=%s",
            active_state.get("name") if active_state else None,
            current_score,
            active_state.get("ragEnabled") if active_state else None,
        )

    # Fetched once and reused by all three branches below. The refresh
    # countdown lives here (not in checkpointed graph state) so a barge-in
    # cancelling an in-flight superstep can't silently discard a decrement
    # that already happened — see RetrievedContextStore's docstring.
    _rc_store = (config or {}).get("configurable", {}).get("retrieved_context_store")

    # Refresh-cadence cache: the exact-content-hash cache inside
    # retrieve_relevant_knowledge rarely hits during live conversation
    # (content is novel every turn), so without this the title-selection
    # LLM call runs on the critical path almost every turn. Instead, only
    # recompute every KNOWLEDGE_RETRIEVAL_REFRESH_TURNS turns and reuse the
    # previous retrieved_context in between — bounded staleness (retrieved
    # knowledge can lag the live topic by up to that many turns) in exchange
    # for skipping the call on most turns. Requires a store to reuse from —
    # without one there's nowhere to keep the countdown, so this turn just
    # computes fresh (same as REFRESH_ENABLED=False).
    if (
        settings.KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED
        and settings.KNOWLEDGE_RETRIEVAL_REFRESH_TURNS > 0
        and _rc_store is not None
        and _rc_store.turns_until_refresh > 0
    ):
        logger.debug(
            "[RAG_REFRESH] retrieve_knowledge: reusing cached context "
            "(%d turn(s) until refresh)",
            _rc_store.turns_until_refresh,
        )
        # Cheap hit/skip signal for dashboards — merges into the same
        # metadata jsonb the glossary analytics below already use, no
        # migration needed.
        turn_metrics.record(get_room_id(), metadata={"knowledgeRetrievalReused": True})
        # Prefer a background-refreshed context the moment it lands
        # (KNOWLEDGE_RETRIEVAL_ASYNC) instead of waiting for the next
        # refresh-due turn.
        _reused = (
            _rc_store.context
            if settings.KNOWLEDGE_RETRIEVAL_ASYNC and _rc_store.context is not None
            else state.retrieved_context
        )
        _rc_store.turns_until_refresh -= 1
        return {"retrieved_context": _reused}

    knowledge_summary = ", ".join(
        [f"{k}: {v[:20]}..." for k, v in knowledge_map.items()]
    )
    # DEBUG: per-turn — knowledge titles list can be long; not useful at INFO.
    logger.debug(
        "[RAG] Knowledge sources available (n=%d): %s",
        len(knowledge_map),
        knowledge_summary,
    )

    # Stale-while-revalidate (KNOWLEDGE_RETRIEVAL_ASYNC): once a first
    # context exists, refresh-due turns serve the previous context
    # immediately and recompute in a DETACHED task — the ~1s title-selection
    # call leaves the reply gate entirely (same pattern as the
    # episodic-memory compactor). Staleness bound: one refresh cycle. The
    # first computation of a session falls through to the synchronous path
    # below so turn 1 keeps its context.
    if (
        settings.KNOWLEDGE_RETRIEVAL_ASYNC
        and _rc_store is not None
        and (_rc_store.context is not None or state.retrieved_context is not None)
    ):
        if _rc_store.context is None:
            # Seed from state (e.g. worker restarted mid-session or store
            # created after a sync first computation stored to state only).
            _rc_store.context = state.retrieved_context
        if not _rc_store.in_flight:
            _messages_snapshot = list(state.messages)
            # Captured here, in the node, and passed explicitly: the refresh
            # outlives this node, so the room must not depend on the context
            # var still being set when the call returns.
            _usage_room_id = get_room_id()

            async def _refresh_in_background() -> None:
                try:
                    fresh = await asyncio.wait_for(
                        retrieve_relevant_knowledge(
                            llm_client,
                            _messages_snapshot,
                            knowledge_map,
                            glossary_hints=glossary_hints or None,
                            room_id=_usage_room_id,
                            prompt_data=scenario.prompt_data,
                        ),
                        timeout=8.0,
                    )
                except asyncio.CancelledError:
                    raise
                except Exception:  # noqa: BLE001
                    logger.warning(
                        "[RAG_ASYNC] background refresh failed; keeping "
                        "previous context"
                    )
                    return
                # "" (computed, nothing relevant) is a valid cached result —
                # keep it distinct from None (never computed) so empty-RAG
                # scenarios don't re-run the ~1s selection call in-gate on
                # every refresh turn.
                _rc_store.context = fresh or ""
                logger.debug(
                    "[RAG_ASYNC] background refresh complete — context_chars=%d",
                    len(fresh or ""),
                )

            _rc_store._task = asyncio.create_task(_refresh_in_background())
        turn_metrics.record(
            get_room_id(),
            metadata={
                "knowledgeRetrievalReused": True,
                "knowledgeRetrievalAsync": True,
            },
        )
        _rc_store.turns_until_refresh = (
            max(settings.KNOWLEDGE_RETRIEVAL_REFRESH_TURNS - 1, 0)
            if settings.KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED
            else 0
        )
        return {"retrieved_context": _rc_store.context}

    # Wrap in asyncio.wait_for so a hanging upstream LLM doesn't keep this
    # parallel branch (and therefore the graph join) waiting forever, which
    # leaves the user stuck on the "thinking" indicator. On timeout we
    # proceed without retrieved context — the agent still produces a reply.
    try:
        retrieved_context = await asyncio.wait_for(
            retrieve_relevant_knowledge(
                llm_client,
                state.messages,
                knowledge_map,
                glossary_hints=glossary_hints or None,
                room_id=get_room_id(),
                prompt_data=scenario.prompt_data,
            ),
            timeout=8.0,
        )
    except asyncio.TimeoutError:
        logger.warning(
            "[RAG] retrieve_knowledge: timed out after 8s; proceeding without context"
        )
        retrieved_context = None

    if retrieved_context:
        # DEBUG: per-turn — fires on every turn that runs RAG retrieval.
        logger.debug(
            "[RAG] retrieve_knowledge: completed — context_chars=%d",
            len(retrieved_context),
        )
    else:
        logger.debug("[RAG] retrieve_knowledge: completed — no matches")

    # Per-turn glossary selection analytics: which Tier 1 sections the
    # selector actually pulled (section codes). Rides turn_metrics.metadata
    # → scenario_session_turn_metrics, giving per-section hit rate without
    # log archaeology. Only stamped when the session has glossary sections.
    turn_metrics.record(get_room_id(), metadata={"knowledgeRetrievalReused": False})
    if glossary_sections:
        turn_metrics.record(
            get_room_id(),
            metadata={
                "glossary_selected": selected_glossary_sections(
                    retrieved_context, glossary_sections
                ),
            },
        )
    # "" (computed, nothing relevant) is a valid result — keep it distinct
    # from None (never computed) so the async/cadence branches' `is not
    # None` checks above correctly recognize this as already-computed on
    # later turns, instead of re-running the ~1s selection call in-gate
    # every refresh turn for the life of the session. Mirrors the async
    # branch's `fresh or ""` above.
    if _rc_store is not None:
        _rc_store.context = retrieved_context or ""
        _rc_store.turns_until_refresh = (
            max(settings.KNOWLEDGE_RETRIEVAL_REFRESH_TURNS - 1, 0)
            if settings.KNOWLEDGE_RETRIEVAL_REFRESH_ENABLED
            else 0
        )
    return {"retrieved_context": retrieved_context or ""}


@instrumented_node("sync_events_and_behaviors_node")
async def sync_events_and_behaviors_node(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Convergence node for parallel execution paths.

    This node acts as a fan-in point where both detect_behaviors and
    process_events converge before proceeding to resolve_branching_instruction.
    It serves as a synchronization point in the graph to ensure both parallel
    branches complete before continuing with the sequential flow.

    Returns:
        Empty dictionary (pass-through node)
    """
    return {}


@instrumented_node("compact_history")
async def compact_history(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Schedule an update of the rolling conversation summary (episodic memory).

    Terminal node on the reply path — the PRIMARY compaction trigger, firing
    on cadence after replies regardless of whether the learner ever pauses
    (the pause hook in rolling_summary.maybe_compact_on_pause is additive).
    The summarizer LLM call runs as a DETACHED task writing into the
    worker-owned RollingSummaryStore — never inside the graph run — so
    neither this turn nor the next one waits on it (a synchronous version
    measurably added ~1s to the next turn's voice-to-voice latency in the
    Malayalam A/B run).

    Triggers when the un-summarized delta beyond the verbatim tail reaches
    ROLLING_SUMMARY_EVERY_TURNS learner turns OR
    ROLLING_SUMMARY_DELTA_TRIGGER_CHARS characters (turns are not
    equal-sized; the char gate catches verbose languages early). The tail
    itself is bounded by ROLLING_SUMMARY_TAIL_MAX_CHARS. On any failure the
    previous summary is kept and compaction retries on a later turn. Never
    writes graph state — the store is the single source of truth (see
    RollingSummaryStore for why).
    """
    if not settings.ROLLING_SUMMARY_ENABLED:
        return {}

    configurable = (config or {}).get("configurable", {})
    store = configurable.get("rolling_summary_store")
    if store is None:
        return {}
    if store.in_flight:
        logger.debug("[ROLLING_SUMMARY] compaction already in flight; skipping")
        return {}

    _clock = configurable.get("session_clock")
    if _clock is not None and getattr(_clock, "is_paused", False):
        return {}

    from app.core.graph.rolling_summary import (
        count_learner_turns,
        message_chars,
        schedule_compaction,
        summary_boundary_index,
    )

    messages = list(state.messages)
    boundary = summary_boundary_index(
        messages,
        settings.ROLLING_SUMMARY_TAIL_DIALOGUES,
        settings.ROLLING_SUMMARY_TAIL_MAX_CHARS,
    )
    already_covered = max(0, store.covered_count)
    delta = messages[already_covered:boundary] if boundary > already_covered else []
    delta_turns = count_learner_turns(delta)
    delta_size = message_chars(delta)
    turns_due = delta_turns >= max(1, settings.ROLLING_SUMMARY_EVERY_TURNS)
    chars_due = (
        settings.ROLLING_SUMMARY_DELTA_TRIGGER_CHARS > 0
        and delta_size >= settings.ROLLING_SUMMARY_DELTA_TRIGGER_CHARS
    )
    due = delta_turns >= 1 and (turns_due or chars_due)
    # Every other branch in this function that skips (store missing, paused,
    # in-flight, no llm_client) already logs why. This was the one silent
    # gap: "not due yet" is the overwhelmingly common case, so with no trace
    # here there was no way to tell "compaction never fired because it's
    # genuinely early" apart from "compaction is stuck/never firing at all"
    # (see [PROMPT_CACHE] investigation — a session that never compacts once
    # never gets rolling summary's cache-friendly slicing either). INFO, not
    # DEBUG — prod runs at INFO and a debug-level gate log is invisible there.
    logger.info(
        "[ROLLING_SUMMARY_GATE] room=%s boundary=%d already_covered=%d "
        "delta_turns=%d delta_chars=%d turns_due=%s chars_due=%s due=%s",
        get_room_id(),
        boundary,
        already_covered,
        delta_turns,
        delta_size,
        turns_due,
        chars_due,
        due,
    )
    if not due:
        return {}

    llm_client = configurable.get("llm_client")
    if llm_client is None:
        logger.warning("[ROLLING_SUMMARY] no llm_client in config; skipping")
        return {}

    scenario = cast(Scenario, configurable.get("scenario")) if configurable else None
    prompt_data = getattr(scenario, "prompt_data", None) if scenario else None

    _room = configurable.get("room")
    schedule_compaction(
        store,
        previous_summary=store.summary,
        delta=delta,
        boundary=boundary,
        total_count=len(messages),
        llm_client=llm_client,
        prompt_data=prompt_data,
        timeout=settings.ROLLING_SUMMARY_TIMEOUT,
        reason="chars" if (chars_due and not turns_due) else "cadence",
        room_id=getattr(_room, "name", None),
    )
    return {}


@instrumented_node("update_working_memory")
async def update_working_memory(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """Fire the client working memory's consolidation call.

    Terminal node on the reply path, strictly after publish_done_thinking for
    the same reason as compact_history: the consolidation LLM call must not sit
    between the learner finishing a sentence and hearing a reply. It is DETACHED
    on top of that, so the graph run does not wait for it either — p50 turn
    latency is already 3.1s and the weak metrics live in the 5.4s+ band, so a
    serialized call here would move every turn into the worst band we measure.

    Fires every CLIENT_WORKING_MEMORY_EVERY_TURNS learner turns, default every
    turn: the update exists to catch a client-side EVENT (a repair, a rupture, a
    disclosure) and only the call can see one, so a wider cadence misses the
    turn the event happened on rather than saving a call.

    Runs on every reply path — the node is always in the graph — and returns
    immediately for a scenario whose selected prompt declares no working-memory
    placeholder. That prompt-selection check below is the only opt-in there is.

    On any failure the previous memory is kept and the miss is counted without
    advancing the store's monotonic turn, so the next update is free to commit.
    Never writes graph state — the store is the single source of truth, for the
    reason recorded on SimulationState.
    """
    configurable = (config or {}).get("configurable", {})
    _sd_scenario = configurable.get("scenario")
    _sd_prompt_data = getattr(_sd_scenario, "prompt_data", None)
    if _sd_prompt_data is not None and prompt_declares_stage_director(_sd_prompt_data):
        return _schedule_stage_director(state, configurable, _sd_prompt_data)
    store = configurable.get("client_working_memory_store")
    if store is None:
        return {}
    if store.in_flight:
        logger.debug("[working-memory] update already in flight; skipping")
        return {}

    # A paused session is frozen, including its clock. Consolidating through a
    # pause would date observations to a turn the learner has not taken.
    _clock = configurable.get("session_clock")
    if _clock is not None and getattr(_clock, "is_paused", False):
        return {}

    # Same opt-in as the read path, and for the same reason: without it every
    # simulation in the fleet would pay a call per turn, since this node is now
    # unconditionally on the reply path. `turn_index < 0` below would already
    # catch this, since generate_response only opens a turn for an opted-in
    # scenario — but relying on that would make the cost of a mistake in one
    # gate an invisible LLM bill in the other.
    scenario = cast(Scenario, configurable.get("scenario")) if configurable else None
    prompt_data = getattr(scenario, "prompt_data", None) if scenario else None
    if prompt_data is None or not prompt_declares_client_working_memory(prompt_data):
        return {}

    memory = await store.snapshot()
    every = max(1, settings.CLIENT_WORKING_MEMORY_EVERY_TURNS)
    if memory.turn_index < 0 or memory.turn_index % every != 0:
        return {}

    llm_client = configurable.get("llm_client")
    if llm_client is None:
        logger.warning("[working-memory] no llm_client in config; skipping")
        return {}

    from app.core.working_memory.consolidate import schedule_update

    window = max(2, settings.CLIENT_WORKING_MEMORY_WINDOW_TURNS)
    _room = configurable.get("room")

    # The semantic half of recall (§7.3). Optional by design: without an
    # embedding client the pool is ranked lexically, which is a weaker ranking
    # and not a broken one. Passed as a callable rather than the client so the
    # store layer never learns which provider it is talking to.
    _embedding_client = configurable.get("embedding_client")
    # Recorded as working_memory_embedding. The room is the client's own (one
    # per session); the query runs in the detached update, after this node.
    embed_query = (
        functools.partial(
            _embedding_client.get_embedding,
            task=LLMTask.WORKING_MEMORY_EMBEDDING.value,
        )
        if _embedding_client is not None
        else None
    )

    # The TOTAL score — events AND behaviours — since the last update we
    # scheduled. A positive delta means the counsellor did something the
    # SCENARIO AUTHOR scored as helpful, and consolidation treats that as an
    # advancing event.
    #
    # `state.current_score` is deliberately NOT the source, though it is the
    # obvious one. ScoreKeeper keeps two buckets: `_event_score`, fed by the
    # orchestrator, and `_behavior_score`, fed by detect_behaviors. Only the
    # event bucket reaches `state.current_score`, so a counsellor validating,
    # acknowledging and normalising — the behaviours a scenario author actually
    # writes under "Helper should do" — moves the total the learner sees and
    # moves `current_score` not at all. Measured in prod: over 12h fleet-wide,
    # 15 positively-scored behaviour items produced exactly ONE change in
    # `current_score`, and it was negative. Wiring the ladder to that bucket
    # would have made this feature near-inert by construction.
    #
    # The stance the AUTHOR's bands resolve to this turn. Working memory takes
    # it rather than deciding one, so the client's progression is the
    # scenario's, identical to every non-working-memory prompt.
    from app.core.graph.prompt import _resolve_simulation_state_by_score

    _sk = configurable.get("score_keeper")
    _authored_state = _resolve_simulation_state_by_score(
        getattr(prompt_data, "states", None),
        _sk.get_total_score() if _sk is not None else None,
    )
    _authored_stance = (
        str(_authored_state.get("name") or "").strip() if _authored_state else ""
    ) or None

    schedule_update(
        store,
        memory=memory,
        new_messages=list(state.messages)[-window:],
        llm_client=llm_client,
        timeout=settings.CLIENT_WORKING_MEMORY_TIMEOUT,
        prompt_data=prompt_data,
        room_id=getattr(_room, "name", None),
        embed_query=embed_query,
        authored_stance=_authored_stance,
        # ---- internal-monologue panel (display only) ----
        # The preview renders why the client moved. `score` and
        # `credited_behaviours` are read for DISPLAY and never feed the update;
        # `validate` takes `authored_stance` verbatim. Reading the score here is
        # not the stance ladder returning.
        room=_room,
        score=(
            _score_keeper.get_total_score()
            if (_score_keeper := configurable.get("score_keeper")) is not None
            else None
        ),
        credited_behaviours=list(getattr(state, "advancing_behaviour_ids", None) or []),
        locked_topics=_locked_topics_for_display(prompt_data, configurable),
        **_delivery_hooks(
            configurable.get("turn_delivery"),
            "working_memory",
            recent_lines=_recent_character_lines(state.messages),
        ),
    )
    return {}


def _latest_behaviours(state: SimulationState, prompt_data: Any) -> List[str]:
    """This turn's detected behaviours as "helpful: …" / "unhelpful: …" labels."""
    from app.core.working_memory.monologue import _behaviour_labels

    out: List[str] = []
    for item in getattr(state, "behavior_feedback_data", None) or []:
        bid = getattr(item, "behavior_instruction_id", None)
        if not bid:
            continue
        labels = _behaviour_labels(prompt_data, [str(bid)])
        label = labels[0]["label"] if labels else str(bid)
        score = getattr(item, "score", 0) or 0
        out.append(f"{'helpful' if score >= 0 else 'unhelpful'}: {label}")
    return out


def _schedule_stage_director(
    state: SimulationState, configurable: dict, prompt_data: Any
) -> dict:
    """Fire the Stage Director for this turn. Detached; never waits."""
    store = configurable.get("stage_director_store")
    llm_client = configurable.get("llm_client")
    if store is None or llm_client is None:
        return {}
    _clock = configurable.get("session_clock")
    if _clock is not None and getattr(_clock, "is_paused", False):
        return {}
    if store.turn_index < 0:
        return {}

    from app.core.graph.prompt import _resolve_simulation_state_by_score
    from app.core.stage_director.director import schedule_thought

    _sk = configurable.get("score_keeper")
    score = _sk.get_total_score() if _sk is not None else None
    authored = _resolve_simulation_state_by_score(
        getattr(prompt_data, "states", None), score
    )
    current_state = (
        str(authored.get("name") or "").strip() if authored else ""
    ) or None
    _rs_store = configurable.get("rolling_summary_store")
    window = max(2, settings.CLIENT_WORKING_MEMORY_WINDOW_TURNS)
    schedule_thought(
        store,
        prompt_data=prompt_data,
        messages=list(state.messages)[-window:],
        llm_client=llm_client,
        timeout=settings.CLIENT_WORKING_MEMORY_TIMEOUT,
        current_state=current_state,
        rolling_summary=getattr(_rs_store, "summary", None),
        learner_behaviours=_latest_behaviours(state, prompt_data),
        behaviour_ids=list(getattr(state, "advancing_behaviour_ids", None) or []),
        score=score,
        room=configurable.get("room"),
        record_store=configurable.get("client_working_memory_store"),
    )
    return {}


def _trim_after_opener(turn_delivery, text):
    """The same leading-hesitation trim the spoken stream got, for the history.

    The graph REMEMBERS what it said; if memory keeps "Hmm… it definitely…"
    while the learner heard "It definitely…", the actor re-learns to open with
    the opener on every following turn. Never raises.
    """
    try:
        opener = getattr(turn_delivery, "opener", None)
        if not isinstance(text, str) or opener is None or not opener.made_a_sound:
            return text
        if not getattr(settings, "REPLY_TRIM_LEADING_HESITATION", True):
            return text
        from app.core.livekit.reply_shaping import LeadingHesitationTrimmer

        trimmer = LeadingHesitationTrimmer(
            phrases=lambda: [p for p in (opener.spoken, *opener.interim) if p],
            is_active=lambda: True,
        )
        out = trimmer.feed(text) + trimmer.flush()
        return out or text
    except Exception:  # noqa: BLE001 - history must never cost the reply
        return text


def _delivery_reply_note(config: Optional[RunnableConfig]) -> Optional[str]:
    """The TurnDelivery note for this turn's opener, or None. Never raises."""
    try:
        turn_delivery = (config or {}).get("configurable", {}).get("turn_delivery")
        return turn_delivery.reply_note() if turn_delivery is not None else None
    except Exception:  # noqa: BLE001 - a note must never cost the reply
        logger.debug("[DELIVERY] reply note skipped", exc_info=True)
        return None


def _recent_character_lines(messages, count: int = 6) -> List[str]:
    """The character's last few lines, which an interim piece must not replay."""
    lines: List[str] = []
    for msg in reversed(list(messages or [])):
        if isinstance(msg, AIMessage):
            text = str(getattr(msg, "content", "") or "").strip()
            if text:
                lines.append(text)
                if len(lines) >= count:
                    break
    return lines


def _delivery_hooks(turn_delivery, source: str, recent_lines=()) -> dict:
    """``schedule_update`` kwargs that route a proposed delivery plan to the worker.

    Empty when the session has no active delivery layer (fillers off, a voice
    that renders no clips, or DELIVERY_PLAN_ENABLED off): the updater prompt is
    then told there are no openers and the field stays empty.
    """
    if turn_delivery is None or not getattr(turn_delivery, "active", False):
        return {}
    catalog = getattr(turn_delivery, "catalog", None)
    if catalog is None or not catalog.entries:
        return {}
    from app.core.livekit.delivery import validate_delivery

    def _on_delivery(proposal, turn_index: int) -> None:
        # The last few turns' interims count too, so the same words — or the
        # same opening — aren't played turn after turn.
        previous = list(getattr(turn_delivery, "recent_interims", ()) or ())
        turn_delivery.set_plan(
            validate_delivery(
                proposal,
                catalog,
                source=source,
                made_after_turn=turn_index,
                recent_lines=recent_lines,
                recent_interims=previous,
            )
        )

    return {
        "opener_catalog": catalog.describe_for_prompt(),
        "on_delivery": _on_delivery,
    }


def _locked_topics_for_display(prompt_data: Any, configurable: dict) -> List[str]:
    """The locked-memory titles the actor's prompt carried this turn.

    Read from the session's high-water mark WITHOUT observing a new state: this
    runs after the reply, and the prompt was built from the mark as it stands
    now. Display only — for the internal-monologue panel.
    """
    sources = getattr(prompt_data, "knowledge_sources", None)
    if not has_memory_locks(sources):
        return []
    tracker = getattr(configurable.get("retrieved_context_store"), "unlocks", None)
    _, locked = partition_memory_sources(
        sources,
        getattr(prompt_data, "states", None),
        tracker.highest_rung if tracker is not None else -1,
    )
    return locked_memory_topics(locked)


@instrumented_node("clear_events_and_detected_data")
async def clear_events_and_detected_data(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Clear events and detected events data for report builder graph.

    This node is used specifically in the report graph to ensure
    clean state by clearing all event-related data structures including
    detected events and feedback data.

    Returns:
        Dictionary with cleared event data structures
    """
    return {
        "branching_and_feedback_data": None,
        "non_branching_feedback_data": None,
        "feedback_to_send": None,
        "behavior_feedback_data": None,
        "retrieved_context": None,
    }
