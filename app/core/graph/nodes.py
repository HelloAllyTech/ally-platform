import asyncio
from datetime import datetime, timezone
from typing import Optional, cast

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from app.core.config import settings
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

    # Retrieve orchestrator and dependencies once to use throughout the function
    orchestrator = None
    room = None
    embedding_client = None
    if config and "configurable" in config:
        orchestrator = config["configurable"].get("event_orchestrator")
        room = config["configurable"].get("room")
        embedding_client = config["configurable"].get("embedding_client")

    # Inject embedding client for SemanticSimilarityEvent
    # (survives LangGraph serialization)
    if embedding_client:
        from app.core.events.event_types.semantic_similarity.semantic_similarity_event import (  # noqa: E501
            SemanticSimilarityEvent,
        )

        SemanticSimilarityEvent._EMBEDDING_CLIENT = embedding_client

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
        last_occurred_at = None
        occurrence_count = 0

        if orchestrator:
            last_occurred_at = orchestrator.get_last_occurred_at(event.event_id)
            occurrence_count = orchestrator.get_occurrence_count(event.event_id)

        # Check ALL windows (Time, Score, Cooldown)
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


async def resolve_branching_instruction(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """
    Resolve branching instruction with LLM calls if needed.

    This function:
    1. Determines branching instruction for LLM (only if branching_instruction exists)
    2. Resolves LLM response tags in branching instructions (if needed)
    3. Selects feedback message to send to UI:
       - If branching event was selected: use its feedback
       - Otherwise: use highest score event's feedback

    This node is wrapped in a subgraph to prevent its LLM outputs from being
    streamed to TTS/UI (workaround for LiveKit issue #2836).

    Branching Instruction Logic:
    - Only use branching_instruction if it exists (highest score branching event)
    - If no branching_instruction exists, LLM response is generated without it

    Feedback Selection Logic:
    - Priority 1: If branching event was selected, use its feedback for UI
    - Priority 2: Otherwise, use highest score event's feedback for UI
    """
    logger.info("Resolving branching instruction")

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
            branching_instruction_obj = (
                selected_branching_event_data.branching_instruction
            )

            # Lazily resolve llm_response tags if present (one-time operation)
            # Check flag first to avoid method call overhead on subsequent turns
            if branching_instruction_obj.needs_llm_resolution():
                # Get language_code and branching_llm_config from scenario if available
                # Use dedicated branching_llm_config for structured output support,
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

                await branching_instruction_obj.resolve_llm_responses(
                    llm_config=llm_config_for_branching,
                    language_code=language_code,
                )

            # Use the branching instruction content (with llm_response tags resolved)
            next_instruction = (
                branching_instruction_obj.resolve_dynamic_branching_instruction(
                    state.messages
                )
            )

    # Determine feedback message for UI
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

    return {
        "next_instruction": next_instruction,
        "feedback_to_send": feedback_to_send,
    }


async def generate_response(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    """
    Generate LLM response and handle event feedback.

    This function:
    1. Uses resolved branching instruction from state (resolved in previous node)
    2. Generates LLM response using the branching instruction (if any)
    3. Sends feedback to UI after STT/TTS flow completes
    4. Clears branching_and_feedback_data after processing
    """
    logger.info("Generating response")

    # Use resolved branching instruction from state
    next_instruction = state.next_instruction
    feedback_to_send = state.feedback_to_send

    # Build system message from scenario and prepend only for the LLM call
    scenario = (
        cast(Scenario, config["configurable"].get("scenario")) if config else None
    )

    # Get language code for multilingual enhancements
    language_code = DEFAULT_LANGUAGE_CODE
    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code
        logger.info(
            f"Using language code '{language_code}' from scenario "
            f"(multilingual method: {settings.MULTILINGUAL_METHOD})"
        )
    else:
        logger.info(
            f"Using default language code '{language_code}' "
            f"(multilingual method: {settings.MULTILINGUAL_METHOD})"
        )

    system_message = None
    if scenario is not None:
        system_message = generate_system_message(
            prompt_data=scenario.prompt_data,
            next_instruction=next_instruction,
            language_code=language_code,
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
                # Ensure method is a string (fallback to "none" if invalid)
                safe_method = (
                    settings.MULTILINGUAL_METHOD
                    if isinstance(settings.MULTILINGUAL_METHOD, str)
                    else "none"
                )

                evaluation_logger.log_interaction(
                    input_text=last_user_message,
                    output_text=response.content,
                    language_code=safe_language_code,
                    method=safe_method,
                    metadata={
                        "scenario_id": scenario.name if scenario else None,
                        "model": getattr(llm_instance, "model_name", None)
                        or getattr(llm_instance, "model", None),
                    },
                    session_id=session_id,  # Pass session_id for conversation tracking
                )
        except Exception as e:
            logger.warning(f"Failed to log interaction for evaluation: {e}")

    # Prepare the final messages
    # Note: response.content is the agent's conversation response
    # - it should not contain parameters dict
    # Parameters are generated separately in apply_voice_expressions node
    # and go to update_options() only
    messages = [AIMessage(content=response.content)]

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
        next_instruction=None,  # Reset after use
        feedback_to_send=None,  # Reset after use
    )


async def apply_voice_expressions(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
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
        return state

    # Early return if provider doesn't support voice expression parameters
    # This avoids unnecessary processing for providers like Deepgram
    parameter_metadata = tts_client.get_parameter_metadata()
    if not parameter_metadata:
        logger.debug(
            "Provider does not support voice expression parameters, "
            "skipping voice expression node"
        )
        return state

    # Get the last message (the generated response)
    if not state.messages:
        return state

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
        return state

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

    # For providers WITH text enhancement:
    # - enhanced_text contains text with tags (SSML, etc.)
    # - We update the message content with the enhanced text
    if enhanced_text is not None:
        # Text was enhanced (provider supports text enhancement)
        # Update message content with enhanced text
        updated_messages = state.messages.copy()
        # Replace the last message with enhanced text
        updated_messages[-1] = AIMessage(content=enhanced_text)

        final_state = SimulationState(
            messages=updated_messages,
            permitted_events=state.permitted_events,
            events_accumulator=state.events_accumulator,
            current_score=state.current_score,
            new_events=state.new_events,
            branching_and_feedback_data=(state.branching_and_feedback_data),
        )

        return final_state

    # Text was not enhanced (provider doesn't support text enhancement, like Hume)
    # Parameters have already been applied via update_options() in
    # generate_and_apply_voice_expressions()
    # Message content remains unchanged
    return state
