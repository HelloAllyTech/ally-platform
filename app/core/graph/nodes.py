import asyncio
from datetime import datetime, timezone
from typing import TYPE_CHECKING, List, Optional, cast

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.schemas import CustomUIEventMessageType
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.scenario.base import Scenario
from app.llms import create_llm_client
from app.utils.event_handler import send_event_to_ui
from app.utils.logger import logger

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator


async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Process events in the state and collect event data for later processing.

    This function:
    1. Detects events from conversation messages
    2. Updates the event registry and evaluates combination expressions
    3. Sends events to Core (backend) immediately for real-time tracking
    4. Collects branching_and_feedback_data (branching instructions +
       feedback) to be stored in state
    5. Returns branching_and_feedback_data which will be processed in
       generate_response

    Branching and Feedback Data Flow:
    - Events are detected and sent to Core immediately (backend needs real-time updates)
    - Branching and feedback data is collected and stored in
      state.branching_and_feedback_data
    - This branching_and_feedback_data will be processed in
      generate_response to:
      * Determine which branching instruction to use for LLM guidance
      * Determine which feedback message to send to UI

    Returns:
        Dictionary with updated state including branching_and_feedback_data field
    """

    async def detect_single_event(event: BaseEvent, chat_messages: List[ChatMessage]):
        if await event.detect_event(chat_messages):  # async call
            return event
        return None

    chat_messages = convert_messages_to_chat_messages(state.messages)

    current_elapsed_seconds = 0.0

    if config and "configurable" in config:
        # Retrieve the ISO string passed from your worker
        joined_at_raw = config["configurable"].get("agent_joined_at")
        if joined_at_raw:
            now_utc = datetime.now(timezone.utc)
            joined_time = None

            try:
                # Parse the ISO string (e.g., "2023-10-27T10:00:00+00:00")
                if isinstance(joined_at_raw, str):
                    joined_time = datetime.fromisoformat(joined_at_raw)
                elif isinstance(joined_at_raw, datetime):
                    joined_time = joined_at_raw

                if joined_time:
                    # Ensure timezone awareness to match now_utc
                    if joined_time.tzinfo is None:
                        joined_time = joined_time.replace(tzinfo=timezone.utc)

                    # Calculate elapsed time in seconds
                    current_elapsed_seconds = (now_utc - joined_time).total_seconds()

            except ValueError as e:
                logger.error(
                    f"Error parsing agent_joined_at: {e}. Defaulting elapsed time to 0."
                )

    logger.debug(f"Current session elapsed time: {current_elapsed_seconds:.2f} seconds")

    tasks = []
    skipped_count = 0

    for e in state.permitted_events:
        # Treat None as open boundaries
        # start_time=None -> Starts at 0
        # end_time=None -> Runs forever (Infinity)
        det_config = e.detection_configuration

        # Get raw values (handling if config or values are None)
        raw_start = det_config.start_time if det_config else None
        raw_end = det_config.end_time if det_config else None

        # Apply defaults: None -> 0 (start) or Infinity (end)
        event_start = raw_start if raw_start is not None else 0
        event_end = raw_end if raw_end is not None else float("inf")

        # Strict filtering: Only create LLM task if within the window
        if event_start <= current_elapsed_seconds <= event_end:
            tasks.append(asyncio.create_task(detect_single_event(e, chat_messages)))
        else:
            skipped_count += 1

    if skipped_count > 0:
        logger.debug(
            f"Event optimization: Skipped {skipped_count} events outside time window."
        )

    # Preserve completion order (like as_completed in threads)
    detected_events = []
    if tasks:
        for t in asyncio.as_completed(tasks):
            result = await t
            if result is not None:
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                detected_events.append((timestamp, result))

    logger.debug(f"Detected Event number: {len(detected_events)}")

    new_events = [event for _, event in detected_events]

    # Calculate the score change from directly detected events only
    # (not combination events)
    score_change = sum(event.score for event in new_events if event.score)
    new_current_score = state.current_score + score_change

    if score_change != 0:
        logger.info(
            f"Score change: {state.current_score} → {new_current_score} "
            f"(change: {score_change:+d})"
        )

    # Update EventOrchestrator and process events
    # Events are sent to Core immediately, but branching_and_feedback_data
    # is collected for state
    # Score-based events will also be checked and triggered if the score
    # changed
    additional_score_from_triggered_events = 0
    branching_and_feedback_data = []
    if config and "configurable" in config:
        event_orchestrator: Optional[EventOrchestrator] = config["configurable"].get(
            "event_orchestrator"
        )
        room = config["configurable"].get("room")

        if event_orchestrator is not None:
            # Get event IDs from detected events (currently only
            # similarity-based events are detected)
            detected_event_ids = {event.event_id for event in new_events}

            # Update registry, evaluate expressions, check score-based events,
            # and send events to Core immediately
            # This will send combination events and score-based events too,
            # but we don't include them in state
            # Returns:
            # - additional_score: Additional score from triggered
            #   score-based/time/combination events
            # - branching_and_feedback_data: Unified data (branching + feedback)
            #   to be stored in state
            (
                _,
                additional_score_from_triggered_events,
                branching_and_feedback_data,
            ) = await event_orchestrator.handle_events(
                room=room,
                detected_event_ids=(detected_event_ids if detected_event_ids else None),
            )

            if branching_and_feedback_data:
                logger.info("Branching and Feedback Data Collected:")
                for idx, data in enumerate(branching_and_feedback_data, 1):
                    feedback_msg = (
                        data.feedback.message
                        if data.feedback and data.feedback.message
                        else "None"
                    )
                    logger.info(
                        f"    [{idx}] Event Score: {data.score} | "
                        f"Branching: {data.branching_instruction or 'None'} | "
                        f"Feedback: {feedback_msg}"
                    )
            if additional_score_from_triggered_events != 0:
                logger.info(
                    f"Additional score from triggered events: "
                    f"{additional_score_from_triggered_events:+d}"
                )

    # Add the additional score from triggered events (score-based,
    # time-based, combination events) to the total score
    new_current_score += additional_score_from_triggered_events
    if additional_score_from_triggered_events > 0:
        logger.info(
            f"Additional score from triggered events: "
            f"{additional_score_from_triggered_events}. "
            f"Total score: {new_current_score}"
        )

    # Build update dictionary for state
    # Only include branching_and_feedback_data if we have new ones.
    # If we return [], the reducer clears the state.
    # By omitting the key when empty, we preserve the existing state.
    update_dict = {
        "messages": state.messages,
        "permitted_events": state.permitted_events,
        "events_accumulator": state.events_accumulator + detected_events,
        "new_events": new_events,
        "current_score": new_current_score,
    }

    # Include branching_and_feedback_data if we have new ones
    # This will be processed in generate_response to determine:
    # 1. Which branching instruction to use for LLM
    # 2. Which feedback message to send to UI
    if branching_and_feedback_data:
        update_dict["branching_and_feedback_data"] = branching_and_feedback_data
        logger.info(
            f"Stored {len(branching_and_feedback_data)} "
            f"branching_and_feedback_data entries in state"
        )

    return update_dict


async def generate_response(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    """
    Generate LLM response and handle event feedback.

    This function:
    1. Determines branching instruction for LLM
       (only if branching_instruction exists)
    2. Generates LLM response using the branching instruction (if any)
    3. Selects feedback message to send to UI:
       - If branching event was selected: use its feedback
       - Otherwise: use highest score event's feedback
    4. Sends feedback to UI after STT/TTS flow completes
    5. Clears branching_and_feedback_data after processing

    Branching Instruction Logic (matches old behavior):
    - Only use branching_instruction if it exists (highest score branching event)
    - If no branching_instruction exists, LLM response is generated without it

    Feedback Selection Logic:
    - Priority 1: If branching event was selected, use its feedback for UI
    - Priority 2: Otherwise, use highest score event's feedback for UI
    """
    logger.info("Generating response")

    # Step 1: Determine branching instruction for LLM
    # (only if branching_instruction exists)
    # This matches old behavior - branching instructions only affect LLM if they exist
    next_instruction = None
    selected_branching_event_data = None

    if state.branching_and_feedback_data:
        # Find events with branching instructions
        branching_events = [
            ed for ed in state.branching_and_feedback_data if ed.branching_instruction
        ]

        if branching_events:
            # Use highest score event with branching instruction for LLM
            selected_branching_event_data = max(
                branching_events, key=lambda e: abs(e.score)
            )
            next_instruction = selected_branching_event_data.branching_instruction

    # Step 2: Determine feedback message for UI
    # Priority 1: If branching event was selected, use its feedback
    # Priority 2: Otherwise, use highest score event's feedback
    feedback_to_send = None
    if selected_branching_event_data and selected_branching_event_data.feedback:
        # Use feedback from the selected branching event
        feedback_to_send = selected_branching_event_data.feedback
        logger.info("Priority 1: Using feedback from selected branching event for UI")
    elif state.branching_and_feedback_data:
        # No branching event selected, use highest score event's feedback
        events_with_feedback = [
            ed for ed in state.branching_and_feedback_data if ed.feedback is not None
        ]
        if events_with_feedback:
            selected_event_data = max(events_with_feedback, key=lambda e: abs(e.score))
            feedback_to_send = selected_event_data.feedback
            logger.info(
                f"Priority 2: Selected highest score event "
                f"(score={selected_event_data.score}) for UI feedback"
            )

    # Build system message from scenario and prepend only for the LLM call
    scenario = (
        cast(Scenario, config["configurable"].get("scenario")) if config else None
    )
    system_message = None
    if scenario is not None:
        system_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
        )

    # Get language code and LLM config from scenario
    language_code = DEFAULT_LANGUAGE_CODE
    llm_config_from_metadata = None
    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code
        llm_config_from_metadata = scenario.language_config.llm_config

    # Prepare the messages for the LLM call without mutating the state
    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    # Create response from LLM using config from metadata or defaults
    try:
        llm_client = create_llm_client(
            llm_config=llm_config_from_metadata, language_code=language_code
        )
        llm_instance = llm_client.llm_instance
    except Exception as e:
        logger.warning(f"LLM config failed for {language_code}, using default: {e}")
        llm_client = create_llm_client(language_code=DEFAULT_LANGUAGE_CODE)
        llm_instance = llm_client.llm_instance

    response = await llm_instance.ainvoke(messages_to_send)

    # Prepare the final messages (do not persist system or instruction in state)
    messages = [AIMessage(response.content)]

    # Step 2: Send feedback to UI after STT/TTS flow completes
    # This ensures feedback is sent only after the agent finishes speaking
    # Score is sent even if there's no feedback message (matches old behavior)
    if config and "configurable" in config:
        room = config["configurable"].get("room")
        if room is not None:
            # Calculate cumulative score from ACTIVE events only
            # (events with feedback object)
            # ACTIVE events always have a feedback object
            # (even if message is None)
            # This matches the old behavior: sum(event.score for event in events)
            # where events were only ACTIVE events
            active_events_data = [
                ed
                for ed in state.branching_and_feedback_data
                if ed.feedback is not None
            ]

            logger.info("Calculating cumulative score for UI:")
            logger.info(f"     ACTIVE events count: {len(active_events_data)}")

            # Send score if there are ACTIVE events (matches old behavior)
            # Cumulative score includes ALL ACTIVE events, even if they don't
            # have feedback messages
            # Old behavior: process_events_for_ui would return None only if
            # no events
            # If events exist, score is always sent even if message/emoji are None
            if active_events_data:
                # Cumulative score: sum of scores from all ACTIVE events
                cumulative_score = sum(ed.score for ed in active_events_data)
                logger.info(
                    f"     Individual scores: {[ed.score for ed in active_events_data]}"
                )
                logger.info(f"     ➜ Cumulative score: {cumulative_score}")

                # Handle feedback message - assign empty string if not present
                # Even if ACTIVE events exist, they may not have feedback messages
                if feedback_to_send:
                    # Feedback object exists, but message might be None
                    feedback_message = (
                        feedback_to_send.message
                        if feedback_to_send.message is not None
                        else ""
                    )
                    feedback_emoji = feedback_to_send.emoji
                    show_feedback = feedback_to_send.show_feedback
                else:
                    # No feedback selected, but we still send the score
                    # (matches old behavior)
                    # This can happen if ACTIVE events exist but none were
                    # selected for feedback
                    feedback_message = ""
                    feedback_emoji = None
                    show_feedback = True

                # Create UI message with cumulative score and selected feedback
                # Score is always sent if there are ACTIVE events,
                # even if message is empty
                ui_message = CustomUIEventMessageType.create(
                    score=cumulative_score,
                    emoji=feedback_emoji,
                    message=feedback_message,
                    timestamp=datetime.now(timezone.utc).strftime(
                        "%Y-%m-%dT%H:%M:%S.%fZ"
                    ),
                    show_feedback=show_feedback,
                )

                logger.info("Sending feedback to UI:")
                await send_event_to_ui(ui_message, room)
                logger.info("UI feedback sent successfully")

    return SimulationState(
        messages=messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator,
        current_score=state.current_score,
        new_events=[],
        branching_and_feedback_data=[],  # Clear after use
    )
