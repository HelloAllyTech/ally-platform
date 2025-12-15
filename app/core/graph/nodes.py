import asyncio
from datetime import datetime, timezone
from typing import Optional, cast, List, TYPE_CHECKING

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.llms import create_llm_client
from app.core.events.base import ChatMessage, BaseEvent
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.scenario.base import Scenario
from app.utils.logger import logger

if TYPE_CHECKING:
    from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator


async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> dict:
    """Process events in the state (async version, detect_event is async)"""

    async def detect_single_event(event: BaseEvent, chat_messages: List[ChatMessage]):
        if await event.detect_event(chat_messages):  # async call
            return event
        return None

    chat_messages = convert_messages_to_chat_messages(state.messages)
    tasks = [
        asyncio.create_task(detect_single_event(e, chat_messages))
        for e in state.permitted_events
    ]

    # Preserve completion order (like as_completed in threads)
    detected_events = []
    for t in asyncio.as_completed(tasks):
        result = await t
        if result is not None:
            timestamp = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
            detected_events.append((timestamp, result))

    logger.debug(f"Detected Event number: {len(detected_events)}")

    new_events = [event for _, event in detected_events]
    
    # Calculate the score change from directly detected events only (not combination events)
    score_change = sum(event.score for event in new_events if event.score)
    new_current_score = state.current_score + score_change

    # Update EventOrchestrator and send events (combination events are sent but not added to state)
    # Score-based events will also be checked and triggered if the score changed
    additional_score_from_triggered_events = 0
    branching_instruction=[]
    if config and "configurable" in config:
        event_orchestrator: Optional[EventOrchestrator] = config["configurable"].get("event_orchestrator")
        room = config["configurable"].get("room")

        if event_orchestrator is not None:
            # Get event IDs from detected events (currently only similarity-based events are detected)
            detected_event_ids = {event.event_id for event in new_events}

            # Update registry, evaluate expressions, check score-based events, and send events
            # This will send combination events and score-based events too, but we don't include them in state
            # Pass the new score so score-based events can be checked
            # Returns additional score from triggered score-based/time/combination events
            _, additional_score_from_triggered_events,branching_instruction = await event_orchestrator.handle_events(
                room=room,
                detected_event_ids=detected_event_ids if detected_event_ids else None,
            )

    # Add the additional score from triggered events (score-based, time-based, combination events)
    # to the total score
    new_current_score += additional_score_from_triggered_events
    if additional_score_from_triggered_events > 0:
        logger.info(f"Additional score from triggered events: {additional_score_from_triggered_events}. Total score: {new_current_score}")

    # Only include branching_instructions if we have new ones.
    # If we return [], the reducer clears the state.
    # If we return state.branching_instructions + new, the reducer duplicates the state.
    # By omitting the key when empty, we preserve the existing state.
    update_dict = {
        "messages": state.messages,
        "permitted_events": state.permitted_events,
        "events_accumulator": state.events_accumulator + detected_events,
        "new_events": new_events,
        "current_score": new_current_score,
    }
    
    if branching_instruction:
        update_dict["branching_instructions"] = branching_instruction

    return update_dict


async def generate_response(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    logger.info("Generating response")

    # Determine next conversation-specific instruction using maximum magnitude selection
    # Select the instruction with the highest absolute score (positive or negative)
    next_instruction = None
    logger.info(f"Branching instructions: {state.branching_instructions}")
    if state.branching_instructions:
        # Filter for non-empty instructions
        valid_instructions = [
            (instruction, score)
            for instruction, score in state.branching_instructions
            if instruction and instruction.strip()
        ]

        if valid_instructions:
            # Select instruction with maximum magnitude (highest absolute value)
            selected = max(valid_instructions, key=lambda x: abs(x[1]))
            next_instruction = selected[0]
            logger.info(f"Selected instruction with score {selected[1]} (magnitude {abs(selected[1])}): '{next_instruction}'")

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
            llm_config=llm_config_from_metadata,
            language_code=language_code
        )
        llm_instance = llm_client.llm_instance
    except Exception as e:
        logger.warning(f"LLM config failed for {language_code}, using default: {e}")
        llm_client = create_llm_client(language_code=DEFAULT_LANGUAGE_CODE)
        llm_instance = llm_client.llm_instance

    response = await llm_instance.ainvoke(messages_to_send)

    # Prepare the final messages (do not persist system or instruction in state)
    messages = [AIMessage(response.content)]

    return SimulationState(
        messages=messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator,
        current_score=state.current_score,
        new_events=[],
        branching_instructions=[],  # Clear after use
    )
