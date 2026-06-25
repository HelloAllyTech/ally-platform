import asyncio
import json
from datetime import datetime, timezone
from typing import Any, Dict, Optional, cast

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

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
from app.core.graph.knowledge_retrieval import (
    build_knowledge_map,
    retrieve_relevant_knowledge,
)
from app.core.graph.prompt import (
    _get_selected_prompt_has_states as _selected_prompt_has_states_for_retrieval,
)
from app.core.graph.prompt import (
    _resolve_simulation_state_by_score as _resolve_state_for_retrieval,
)
from app.core.graph.prompt import generate_system_message
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


@instrumented_node("process_events")
async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Process events, optimizing detection based on Time, Score, and Cooldown windows.
    Collects branching_and_feedback_data for later processing.

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

        # 2. Detect events in parallel
        with timing.operation("Event detection"):
            detected_events, new_events = await _detect_events(
                state.permitted_events,
                chat_messages,
                elapsed_time,
                live_score,
                orchestrator,
            )

        # 3. Orchestrate and split events
        # (all events together to avoid duplicate processing)
        # CRITICAL: orchestrate_events has side effects:
        # - Sends events to Core (SQS) via _send_events_to_core
        # - Updates live_score via _update_live_score
        # - Handles termination callbacks via _handle_termination_events
        # All of these happen inside orchestrate_events, so they're preserved.
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

    return {
        "next_instruction": next_instruction,
        "feedback_to_send": feedback_to_send,
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
    human_indices = [
        i for i, m in enumerate(messages) if isinstance(m, HumanMessage)
    ]
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

    # Use resolved branching instruction from state
    next_instruction = state.next_instruction

    # Build system message from scenario and prepend only for the LLM call
    scenario = (
        cast(Scenario, config["configurable"].get("scenario")) if config else None
    )

    # ElevenLabs v3 supports inline audio tags ([pause], [sighs], [empathetic],
    # ...). When the scenario's TTS provider supports them, fold the tag guidance
    # into the persona prompt so the agent emits tags inline as it generates —
    # letting tokens stream straight to TTS (STREAM_RESPONSE) instead of waiting
    # on a second prosody LLM call to rewrite the reply (skipped via
    # PROSDY_FORCE_SKIP). The guidance TEXT is resolved from prompt management
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
                    # but warn — v3 would otherwise speak tag-less with no signal
                    # (the prosody fallback that used to add tags is force-skipped).
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

    # Get language code
    language_code = DEFAULT_LANGUAGE_CODE
    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code
        logger.info(f"Using language code '{language_code}' from scenario")
    else:
        logger.info(f"Using default language code '{language_code}'")

    system_message = None
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
        system_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
            language_code=language_code,
            behavior_instructions=scenario.behavior_instructions,
            current_state=current_state,
            retrieved_context=state.retrieved_context,
            current_score=turn_score,
            audio_tag_instructions=audio_tag_instructions,
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

    # Get LLM client from config (pre-configured in AgentSetup) or create dynamically
    llm_client = None
    if config and "configurable" in config:
        llm_client = config["configurable"].get("llm_client")

    # Fallback: Create LLM client dynamically if not provided (backward compatibility)
    if llm_client is None:
        llm_config_from_metadata = None
        if scenario and scenario.language_config:
            llm_config_from_metadata = scenario.language_config.llm_config

        try:
            llm_client = create_llm_client(
                llm_config=llm_config_from_metadata, language_code=language_code
            )
        except Exception as e:
            logger.warning(f"LLM config failed for {language_code}, using default: {e}")
            llm_client = create_llm_client(language_code=DEFAULT_LANGUAGE_CODE)

    # Prepare the messages for the LLM call without mutating the state. When the
    # scenario opts in (Studio "Trim History" toggle) and the global kill-switch
    # is on, send only the last N exchanges to bound input tokens / latency. The
    # system prompt carries the persona/scenario/RAG context, so trimming only
    # drops the literal wording of older turns.
    history = state.messages
    scenario_trim_on = bool(
        getattr(getattr(scenario, "prompt_data", None), "history_trim_enabled", False)
    )
    if (
        settings.HISTORY_TRIM_ENABLED
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

            emit_llm_usage(
                room_id=get_room_id(),
                provider=_gen_config.get("llm_provider"),
                model=llm_model_name,
                task=LLMTask.AGENT_TURN.value,
                usage=extract_usage_from_aimessage(response),
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
        response = AIMessage(content="Sorry, can you say that again?")
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
    if config and "configurable" in config:
        _clock = config["configurable"].get("session_clock")
        if _clock is not None:
            _clock.last_agent_utterance = response.content

    return {
        "messages": [AIMessage(content=response.content)],
        "new_events": [],
        "next_instruction": None,
        "retrieved_context": None,
    }


@instrumented_node("send_event_feedback")
async def send_event_feedback(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Send all feedback (events + behaviors) to UI after LLM response generation.

    This node is placed at the end of the agent graph (after
    apply_voice_expressions) and is NOT used by the report graph.

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

        if room is not None:
            logger.info(
                f"Sending {len(state.behavior_feedback_data)} "
                f"behavior feedback entries to BE"
            )
            log_side_effect(
                "sqs_behavior_feedback_send",
                count=len(state.behavior_feedback_data),
            )
            for bf_data in state.behavior_feedback_data:
                behavior_data = {
                    "behaviorInstructionId": bf_data.behavior_instruction_id,
                    "score": bf_data.score,
                    "category": bf_data.category.value,
                }
                core_behavior_message = (
                    CoreEventMessageType.create_behavior_instruction(
                        room_id=room.name,
                        behavior_instruction_data=behavior_data,
                    )
                )
                await msg_event_queue.send_message(
                    message_body=core_behavior_message.model_dump_json()
                )

            logger.info("Behavior feedback sent to BE successfully")
        else:
            logger.warning("No room available, skipping behavior feedback sending")

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
    if not knowledge_sources:
        # DEBUG: per-turn — most scenarios don't configure knowledge sources.
        logger.debug(
            "[RAG] retrieve_knowledge: no knowledge_sources; skipping retrieval"
        )
        return {"retrieved_context": None}

    knowledge_map = build_knowledge_map(knowledge_sources)
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

    knowledge_summary = ", ".join(
        [f"{k}: {v[:20]}..." for k, v in knowledge_map.items()]
    )
    # DEBUG: per-turn — knowledge titles list can be long; not useful at INFO.
    logger.debug(
        "[RAG] Knowledge sources available (n=%d): %s",
        len(knowledge_map),
        knowledge_summary,
    )

    # Wrap in asyncio.wait_for so a hanging upstream LLM doesn't keep this
    # parallel branch (and therefore the graph join) waiting forever, which
    # leaves the user stuck on the "thinking" indicator. On timeout we
    # proceed without retrieved context — the agent still produces a reply.
    try:
        retrieved_context = await asyncio.wait_for(
            retrieve_relevant_knowledge(llm_client, state.messages, knowledge_map),
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
    return {"retrieved_context": retrieved_context or None}


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


@instrumented_node("apply_voice_expressions")
async def apply_voice_expressions(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> Dict:
    """
    Generate and apply voice expressions based on the generated response.

    Uses a unified LLM call to:
    1. Generate voice expression parameters (speed, tone, etc.) and apply them
    2. Generate enhanced text with provider-specific tags (if supported)
    3. Update message content with enhanced text

    This unified approach reduces latency and cost by combining both operations
    into a single LLM invocation, while ensuring consistency between parameters
    and text enhancement.

    Args:
        state: Current simulation state
        config: Runnable config with TTS client and LLM client

    Returns:
        Updated simulation state with enhanced message content if text was enhanced
    """

    # Get room upfront — done_thinking fires here regardless of voice path taken
    room = None
    if config and "configurable" in config:
        room = config["configurable"].get("room")

    # Baseline so the prosody metric is populated even when this node
    # early-returns (provider without prosody params, empty response, etc.).
    # The complete/timeout/skip paths below overwrite this with the real value.
    turn_metrics.record(get_room_id(), prosody_ms=0)

    try:
        # Get TTS client, LLM client, and scenario from config
        tts_client = None
        llm_client = None
        scenario = None
        if config and "configurable" in config:
            tts_client = config["configurable"].get("tts_client")
            llm_client = config["configurable"].get("llm_client")
            scenario = (
                cast(Scenario, config["configurable"].get("scenario"))
                if config
                else None
            )

        if not tts_client or not llm_client:
            logger.debug(
                "No TTS client or LLM client available, "
                "skipping voice expression application"
            )
            return {}

        # Early return if provider doesn't support voice expression parameters
        # This avoids unnecessary processing for providers like Deepgram
        parameter_metadata = tts_client.get_parameter_metadata()
        if not parameter_metadata:
            logger.debug(
                "Provider does not support voice expression parameters, "
                "skipping voice expression node"
            )
            return {}

        # Get the last message (the generated response)
        if not state.messages:
            return {}

        last_message = state.messages[-1]
        response_text = None

        if hasattr(last_message, "content"):
            response_text = last_message.content
        elif isinstance(last_message, str):
            response_text = last_message

        if not response_text:
            logger.debug(
                "[apply_voice_expressions] No response text found, "
                "skipping voice expression application"
            )
            return {}

        # Skip runtime prosody when under pressure (keeps last params, reduces latency)
        # NOTE: the conditional has_text_enhancement branch below preserves tags
        # only on the legacy (non-force-skip) path. By default PROSDY_FORCE_SKIP
        # is True and short-circuits everything here: ElevenLabs v3 audio tags are
        # now produced INLINE by generate_response (the persona prompt carries the
        # tag instructions), so the second rewrite call is unnecessary and the
        # streamed reply — tags included — goes straight to TTS.
        response_len = len(response_text)
        skip_prosody = False
        skip_reason = ""
        has_text_enhancement = tts_client.supports_text_enhancement()
        # Per-simulation override: if scenario has prosody disabled, skip
        # unconditionally (takes precedence over PROSDY_SKIP_ENABLED and
        # text-enhancement providers).
        prompt_data = getattr(scenario, "prompt_data", None)
        if settings.PROSDY_FORCE_SKIP:
            skip_prosody = True
            skip_reason = "PROSDY_FORCE_SKIP enabled (latency kill-switch)"
        elif prompt_data is not None and not getattr(
            prompt_data, "enable_prosody", True
        ):
            skip_prosody = True
            skip_reason = "prosody disabled for simulation"
        elif not settings.PROSDY_SKIP_ENABLED:
            pass  # Skip logic disabled, always run prosody
        elif has_text_enhancement:
            pass  # Provider needs enhanced text; skip would cause faster speech
        elif response_len < settings.PROSDY_SKIP_MIN_RESPONSE_LENGTH:
            skip_prosody = True
            min_len = settings.PROSDY_SKIP_MIN_RESPONSE_LENGTH
            skip_reason = f"response too short ({response_len} < {min_len} chars)"
        elif (
            settings.PROSDY_SKIP_MAX_RESPONSE_LENGTH > 0
            and response_len > settings.PROSDY_SKIP_MAX_RESPONSE_LENGTH
        ):
            skip_prosody = True
            max_len = settings.PROSDY_SKIP_MAX_RESPONSE_LENGTH
            skip_reason = f"response too long ({response_len} > {max_len} chars)"
        elif settings.PROSDY_SKIP_WHEN_EVENTS_DETECTED and state.new_events:
            skip_prosody = True
            skip_reason = f"events detected this turn ({len(state.new_events)} events)"

        if skip_prosody:
            logger.debug(
                "[apply_voice_expressions] Skipped prosody (%s)",
                skip_reason,
            )
            turn_metrics.record(get_room_id(), prosody_skipped=True, prosody_ms=0)
            # Re-apply current params to TTS (persists; no LLM call, no enhanced text)
            if hasattr(tts_client, "_current_params") and tts_client._current_params:
                tts_client._apply_parameters_dict(tts_client._current_params.copy())
            return {}

        # Extract conversation history (last N messages, excluding the current response)
        conversation_history = []
        if state.messages:
            # Get last N messages (excluding the current response which is the last one)
            messages_for_history = (
                state.messages[:-1] if len(state.messages) > 1 else []
            )
            for msg in messages_for_history[-10:]:  # Last 10 messages
                role = "user"
                content = ""

                # Determine role based on message type
                if isinstance(msg, AIMessage):
                    role = "assistant"
                elif isinstance(msg, HumanMessage):
                    role = "user"
                elif hasattr(msg, "type"):
                    # Fallback to type attribute
                    if msg.type == "ai":
                        role = "assistant"
                    elif msg.type == "human":
                        role = "user"
                elif hasattr(msg, "__class__"):
                    # Fallback to class name
                    class_name = msg.__class__.__name__
                    if "AI" in class_name or "Assistant" in class_name:
                        role = "assistant"
                    elif "Human" in class_name or "User" in class_name:
                        role = "user"

                # Extract content
                if hasattr(msg, "content"):
                    content = msg.content
                elif isinstance(msg, str):
                    content = msg

                if content:
                    conversation_history.append({"role": role, "content": content})

        # Note: response_text comes from the agent's LLM response in
        # generate_response node. It should not contain parameters dict —
        # parameters are generated separately.

        # Generate and apply voice expressions (parameters + enhanced text)
        # in single LLM call
        # This method:
        # 1. Generates parameters (speed, description, etc.)
        #    → applies via update_options() to TTS
        # 2. Returns enhanced text (if supported) or original text (if not supported)
        # CRITICAL: Parameters go ONLY to update_options(), never to message content
        from app.speech_prosody.service import generate_and_apply_prosody_for_message

        # Get current parameters from TTS client for context
        current_parameters = None
        if hasattr(tts_client, "_current_params") and tts_client._current_params:
            current_parameters = tts_client._current_params.copy()

        # Wrap prosody generation in asyncio.wait_for so a hanging upstream
        # prosody LLM call cannot block done_thinking from firing. On timeout
        # we fall back to the original (un-enhanced) text. See
        # PROSODY_GENERATION_TIMEOUT in app/core/config.py.
        _prosody_start = datetime.now(timezone.utc)
        logger.info(
            "[apply_voice_expressions] prosody_call_start timeout=%ss text_chars=%d",
            settings.PROSODY_GENERATION_TIMEOUT,
            len(response_text or ""),
        )
        try:
            enhanced_text = await asyncio.wait_for(
                generate_and_apply_prosody_for_message(
                    tts_client=tts_client,
                    message_text=response_text,
                    llm_client=llm_client,
                    scenario=scenario,
                    conversation_history=conversation_history,
                    current_parameters=current_parameters,
                ),
                timeout=settings.PROSODY_GENERATION_TIMEOUT,
            )
            _prosody_latency = (
                datetime.now(timezone.utc) - _prosody_start
            ).total_seconds()
            logger.info(
                "[apply_voice_expressions] prosody_call_complete latency_s=%.2f "
                "enhanced=%s",
                _prosody_latency,
                enhanced_text is not None,
            )
            turn_metrics.record(
                get_room_id(),
                prosody_ms=int(_prosody_latency * 1000),
                prosody_skipped=False,
            )
        except asyncio.TimeoutError:
            _prosody_latency = (
                datetime.now(timezone.utc) - _prosody_start
            ).total_seconds()
            logger.error(
                "[apply_voice_expressions] prosody_call_timeout latency_s=%.2f "
                "timeout=%ss — falling back to original text",
                _prosody_latency,
                settings.PROSODY_GENERATION_TIMEOUT,
            )
            turn_metrics.record(get_room_id(), prosody_ms=int(_prosody_latency * 1000))
            enhanced_text = None
        except Exception as e:
            _prosody_latency = (
                datetime.now(timezone.utc) - _prosody_start
            ).total_seconds()
            logger.exception(
                "[apply_voice_expressions] prosody_call_failed latency_s=%.2f "
                "error=%s — falling back to original text",
                _prosody_latency,
                str(e),
            )
            enhanced_text = None

        if enhanced_text is not None:
            # Text was enhanced (provider supports text enhancement)
            # Preserve the message ID to ensure it's replaced in state history,
            # not appended, which would cause duplicate speech/history bloat.
            message_id = getattr(last_message, "id", None)
            enhanced_message = AIMessage(content=enhanced_text, id=message_id)

            # Return only the fields that need updating
            return {
                "messages": [enhanced_message],
            }

        # Text was not enhanced (provider doesn't support text enhancement, like Hume)
        # Parameters have already been applied via update_options() in
        # generate_and_apply_voice_expressions()
        # Message content remains unchanged
        return {}

    finally:
        await _publish_done_thinking(room)
