import asyncio
from datetime import datetime, timezone
from typing import Dict, Optional, cast

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.events.base import BaseEvent
from app.core.events.handlers import send_event_to_ui
from app.core.events.schemas import CoreEventMessageType, CustomUIEventMessageType
from app.core.graph.knowledge_retrieval import (
    build_knowledge_map,
    retrieve_relevant_knowledge,
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
from app.core.queue import msg_event_queue
from app.core.scenario.base import (
    Scenario,
    SimulationBehaviorInstruction,
    SimulationStateInstruction,
)
from app.core.scoring.score_keeper import ScoreKeeper
from app.core.time_utils import TimingContext, time_operation
from app.llms import create_llm_client


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
    embedding_client = None
    if config and "configurable" in config:
        orchestrator = config["configurable"].get("event_orchestrator")
        room = config["configurable"].get("room")
        embedding_client = config["configurable"].get("embedding_client")

    # Inject embedding client for SemanticSimilarityEvent
    if embedding_client:
        from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (  # noqa: E501
            SemanticSimilarityEvent,
        )

        SemanticSimilarityEvent._EMBEDDING_CLIENT = embedding_client

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

    async def detect_single_event(event: BaseEvent):
        """
        Detect a single event with error handling and timeout.

        Adds timeout to prevent slow API calls from blocking all event detection.
        This improves reliability and prevents cascading delays.
        """
        try:
            if settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS:
                # Add timeout to prevent slow API calls from blocking everything
                # 10 seconds is reasonable for API calls (binary classifier, embeddings)
                result = await asyncio.wait_for(
                    event.detect_event(chat_messages), timeout=10.0
                )
            else:
                # Old behavior: no timeout
                result = await event.detect_event(chat_messages)
            if result:
                return event
        except asyncio.TimeoutError:
            logger.warning(
                f"Event {event.event_id} detection timed out after 10s, skipping"
            )
        except Exception as e:
            logger.exception(f"Event {event.event_id} detection failed: {e}")
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

    # Detect all eligible events in parallel
    detection_tasks = [
        asyncio.create_task(detect_single_event(event)) for event in eligible_events
    ]

    detected_events_with_timestamps = []

    if detection_tasks:
        logger.debug(f"Detecting {len(detection_tasks)} events in parallel")
        for t in asyncio.as_completed(detection_tasks):
            result = await t
            if result is not None:
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                detected_events_with_timestamps.append((timestamp, result))

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

    with time_operation("Event orchestration"):
        _, additional_score, all_feedback_data = await orchestrator.orchestrate_events(
            room=room,
            detected_event_ids=(detected_event_ids if detected_event_ids else None),
        )

    logger.info(
        f"Event orchestration completed (total events: {len(all_feedback_data)})"
    )

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
                    if config and "configurable" in config:
                        scenario = config["configurable"].get("scenario")
                        if scenario and hasattr(scenario, "language_config"):
                            language_code = scenario.language_config.language_code
                            llm_config_for_branching = (
                                scenario.language_config.branching_llm_config
                            )

                    # Lazily resolve llm_response tags if present (BLOCKING operation)
                    if instruction.needs_llm_resolution():
                        logger.info(
                            "Resolving LLM response tags for branching instruction "
                            "(this may block on LLM call)"
                        )
                        with timing.operation("LLM resolution (blocking)"):
                            await instruction.resolve_llm_responses(
                                llm_config=llm_config_for_branching,
                                language_code=language_code,
                            )

                    # Use the branching instruction content
                    # (with llm_response tags resolved)
                    next_instruction = (
                        await instruction.resolve_dynamic_branching_instruction(
                            messages=state.messages,
                            llm_config=llm_config_for_branching,
                            language_code=language_code,
                        )
                    )

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
        detected = await behavior_instruction.detect(chat_messages)
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
    behavior_instructions: list[SimulationBehaviorInstruction],
    chat_messages: list,
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

    async def detect_with_timeout(
        bi: SimulationBehaviorInstruction,
    ) -> Optional[BehaviorInstructionFeedbackData]:
        try:
            return await asyncio.wait_for(
                _detect_single_behavior_instruction(bi, chat_messages),
                timeout=10.0,
            )
        except asyncio.TimeoutError:
            logger.warning(
                f"Behavior instruction {bi.behavior_instruction_id or ''} "
                f"detection timed out after 10s, skipping"
            )
            return None

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

    # Detect all behavior instructions in parallel
    behavior_feedback = await _detect_behavior_instructions(
        scenario.behavior_instructions, chat_messages
    )

    # Accumulate behavior scores in ScoreKeeper
    if score_keeper and behavior_feedback:
        for feedback in behavior_feedback:
            await score_keeper.add_behavior_score(feedback.score)
        logger.info(
            f"ScoreKeeper: accumulated {len(behavior_feedback)} behavior score(s), "
            f"total behavior score = {score_keeper.behavior_score}"
        )

    return {"behavior_feedback_data": behavior_feedback}


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

        # Let generate_system_message handle routing based on parameters
        system_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
            language_code=language_code,
            behavior_instructions=scenario.behavior_instructions,
            current_state=current_state,
            retrieved_context=state.retrieved_context,
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

    # Prepare the messages for the LLM call without mutating the state
    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    # Get LLM instance
    llm_instance = llm_client.llm_instance

    # Generate response - no tools, just generate response text
    response = await llm_instance.ainvoke(messages_to_send)

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

    return {
        "messages": [AIMessage(content=response.content)],
        "new_events": [],
        "next_instruction": None,
        "retrieved_context": None,
    }


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
        "behavior_feedback_data": [],
    }


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
        return {"retrieved_context": None}

    knowledge_map = build_knowledge_map(knowledge_sources)
    if not knowledge_map:
        return {"retrieved_context": None}

    retrieved_context = await retrieve_relevant_knowledge(
        llm_client, state.messages, knowledge_map
    )

    return {"retrieved_context": retrieved_context or None}


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
        "behavior_feedback_data": [],
        "retrieved_context": None,
    }


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
    # Get TTS client, LLM client, and scenario from config
    tts_client = None
    llm_client = None
    scenario = None
    if config and "configurable" in config:
        tts_client = config["configurable"].get("tts_client")
        llm_client = config["configurable"].get("llm_client")
        scenario = (
            cast(Scenario, config["configurable"].get("scenario")) if config else None
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
    # IMPORTANT: Do NOT skip when provider supports text enhancement (SSML/audio tags).
    # Skipping would send plain text instead of enhanced text, losing pauses and rate
    # variations, which makes speech sound noticeably faster and less natural.
    response_len = len(response_text)
    skip_prosody = False
    skip_reason = ""
    has_text_enhancement = bool(tts_client.get_text_enhancement_instructions())
    if not settings.PROSDY_SKIP_ENABLED:
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
        # Re-apply current params to TTS (persists; no LLM call, no enhanced text)
        if hasattr(tts_client, "_current_params") and tts_client._current_params:
            tts_client._apply_parameters_dict(tts_client._current_params.copy())
        return {}

    # Extract conversation history (last N messages, excluding the current response)
    conversation_history = []
    if state.messages:
        # Get last N messages (excluding the current response which is the last one)
        messages_for_history = state.messages[:-1] if len(state.messages) > 1 else []
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

    # Note: response_text comes from the agent's LLM response in generate_response node
    # It should not contain parameters dict - parameters are generated separately

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

    enhanced_text = await generate_and_apply_prosody_for_message(
        tts_client=tts_client,
        message_text=response_text,
        llm_client=llm_client,
        scenario=scenario,
        conversation_history=conversation_history,
        current_parameters=current_parameters,
    )

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
