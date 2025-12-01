import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Optional, cast, List, TYPE_CHECKING

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from livekit import rtc

from app.core.language_config import DEFAULT_LANGUAGE_CODE
from app.llms import get_llm_for_language
from app.core.constants import VisibilityType
from app.core.config import settings
from app.core.events.base import ChatMessage, BaseEvent
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import convert_messages_to_chat_messages, serialize_event
from app.core.queue import msg_event_queue
from app.core.scenario.base import Scenario
from app.utils.logger import logger

if TYPE_CHECKING:
    from app.core.events.event_registry.event_registry import EventRegistry


async def process_events(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
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

    # Update EventRegistry and send events (combination events are sent but not added to state)
    # Score-based events will also be checked and triggered if the score changed
    additional_score_from_triggered_events = 0
    branching_instruction=[]
    if config and "configurable" in config:
        event_registry: Optional[EventRegistry] = config["configurable"].get("event_registry")
        room = config["configurable"].get("room")

        if event_registry is not None:
            # Get event IDs from detected events (currently only similarity-based events are detected)
            detected_event_ids = {event.event_id for event in new_events}

            # Update registry, evaluate expressions, check score-based events, and send events
            # This will send combination events and score-based events too, but we don't include them in state
            # Pass the new score so score-based events can be checked
            # Returns additional score from triggered score-based/time/combination events
            _, additional_score_from_triggered_events,branching_instruction = await event_registry.handle_events(
                room=room,
                current_score=new_current_score,
                detected_event_ids=detected_event_ids if detected_event_ids else None,
            )

    # Add the additional score from triggered events (score-based, time-based, combination events)
    # to the total score
    new_current_score += additional_score_from_triggered_events
    if additional_score_from_triggered_events > 0:
        logger.info(f"Additional score from triggered events: {additional_score_from_triggered_events}. Total score: {new_current_score}")

    # Merge time-based branching instructions from state with new event instructions
    # Time events that fired between utterances should be included
    # Old instructions from previous utterance should NOT be included (they were already used)
    all_branching_instructions = branching_instruction + state.branching_instructions

    return SimulationState(
        messages=state.messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator + detected_events,
        new_events=new_events,
        current_score=new_current_score,
        branching_instructions=all_branching_instructions
    )


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

    # Get language code from scenario for LLM selection
    language_code = DEFAULT_LANGUAGE_CODE
    if scenario and scenario.language_config:
        language_code = scenario.language_config.language_code

    # Prepare the messages for the LLM call without mutating the state
    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    # Create response from LLM using language-based abstraction
    try:
        llm_response = get_llm_for_language(language_code)
    except Exception as e:
        logger.warning(f"LLM config failed for {language_code}, using default: {e}")
        llm_response = get_llm_for_language(DEFAULT_LANGUAGE_CODE)

    response = await llm_response.ainvoke(messages_to_send)

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
