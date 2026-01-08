import asyncio
from datetime import datetime, timezone
from typing import Optional, cast

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.events.base import BaseEvent
from app.core.events.schemas import CustomUIEventMessageType
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import (
    calculate_elapsed_time,
    convert_messages_to_chat_messages,
    get_live_score,
    is_event_eligible,
)
from app.core.scenario.base import Scenario
from app.llms import create_llm_client
from app.utils.event_handler import send_event_to_ui
from app.utils.logger import logger


async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Process events, optimizing detection based on Time, Score, and Cooldown windows.
    Collects branching_and_feedback_data for later processing.
    """

    # 1. Prepare Context ---
    chat_messages = convert_messages_to_chat_messages(state.messages)
    elapsed_time = calculate_elapsed_time(config)
    live_score = get_live_score(config)

    # Retrieve orchestrator once to use throughout the function
    orchestrator = None
    room = None
    if config and "configurable" in config:
        orchestrator = config["configurable"].get("event_orchestrator")
        room = config["configurable"].get("room")

    logger.debug(f"Event Cycle: Time={elapsed_time:.2f}s, Live Score={live_score}")

    async def detect_single_event(event: BaseEvent):
        if await event.detect_event(chat_messages):
            return event
        return None

    # 2. Filter Events & Create Tasks ---
    tasks = []
    skipped_count = 0

    for event in state.permitted_events:
        # Fetch last occurrence time and
        # occurrence count safely (if orchestrator exists)
        last_occurred_at, occurrence_count = None, None

        if orchestrator:
            last_occurred_at = orchestrator.get_last_occurred_at(event.event_id)
            occurrence_count = orchestrator.get_occurrence_count(event.event_id)

        # Check ALL windows (Time, Score, Cooldown)
        # FIX: Ensure this is NOT indented inside 'if orchestrator:'
        if is_event_eligible(
            event, elapsed_time, live_score, last_occurred_at, occurrence_count
        ):
            tasks.append(asyncio.create_task(detect_single_event(event)))
        else:
            skipped_count += 1

    if skipped_count > 0:
        logger.debug(
            f"Event optimization: Skipped {skipped_count} events (outside windows)."
        )

    # 3. Process Detection Results ---
    detected_events = []
    if tasks:
        # Preserve completion order
        for t in asyncio.as_completed(tasks):
            result = await t
            if result is not None:
                timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
                detected_events.append((timestamp, result))

    logger.debug(f"Detected Event number: {len(detected_events)}")

    new_events = [event for _, event in detected_events]

    # 4. Orchestration (Backend Sync & Logic) ---
    additional_score_from_triggered_events = 0
    branching_and_feedback_data = []

    if orchestrator is not None:
        detected_event_ids = {event.event_id for event in new_events}

        # Updates registry, evaluates expressions, sends to Core
        (
            _,
            additional_score_from_triggered_events,
            branching_and_feedback_data,
        ) = await orchestrator.orchestrate_events(
            room=room,
            detected_event_ids=(detected_event_ids if detected_event_ids else None),
        )

        # Log results
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
                f"Additional score from triggered "
                f"events: {additional_score_from_triggered_events:+d}"
            )

    # 5. State Updates ---
    # Calculate score delta for THIS turn to update LangChain state
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

    update_dict = {
        "messages": state.messages,
        "permitted_events": state.permitted_events,
        "events_accumulator": state.events_accumulator + detected_events,
        "new_events": new_events,
        "current_score": new_current_score,
    }

    if branching_and_feedback_data:
        update_dict["branching_and_feedback_data"] = branching_and_feedback_data
        logger.info(
            f"Stored {len(branching_and_feedback_data)} branching_and_feedback_data"
            f" entries in state"
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
