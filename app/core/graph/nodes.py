import asyncio
import logging
import random
from datetime import datetime, timezone
from typing import Optional, cast, List

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from livekit import rtc

from app.core.config import settings
from app.core.constants import VisibilityType
from app.core.events.base import ChatMessage, BaseEvent
from app.core.events.core_event_sender import CoreEventMessageType
from app.core.events.ui_event_sender import send_event, CustomUIEventMessageType
from app.core.events.event_processor import EventProcessor
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import convert_messages_to_chat_messages, serialize_event
from app.core.queue import msg_event_queue
from app.core.scenario.base import Scenario
from app.utils.logger import logger


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

    logger.debug(f"Detected events: {str(detected_events)}")
    logger.debug(f"Detected Event number: {len(detected_events)}")

    new_events = [event for _, event in detected_events]

    # Calculate the score change from new events
    score_change = sum(event.score for event in new_events if event.score)
    new_current_score = state.current_score + score_change

    return SimulationState(
        messages=state.messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator + detected_events,
        new_events=new_events,
        current_score=new_current_score,
    )


async def send_events_to_ui(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    logger.info("Sending events to UI")
    room = cast(rtc.Room, config["configurable"].get("room"))
    logger.debug(f"New events: {state.new_events}")

    if state.new_events:
        # Filter events to only include ACTIVE events for UI
        active_events = [
            event
            for event in state.new_events
            if event.visibility_type == VisibilityType.ACTIVE
        ]
        logger.debug(
            f"Active events for UI: {len(active_events)} out of {len(state.new_events)} total events"
        )

        if active_events:
            # Log event summary for debugging only if debug level is enabled
            if logger.isEnabledFor(logging.DEBUG):
                event_summary = EventProcessor.get_events_summary(active_events)
                logger.debug(f"Active events summary: {event_summary}")

            # Process only ACTIVE events using the two-part logic
            ui_message_type = EventProcessor.process_events_for_ui(active_events)

            # Only send event if it is identified
            if ui_message_type is not None:
                await send_event(ui_message_type, room)
        else:
            logger.debug("No ACTIVE events to send to UI")

    return state


async def generate_response(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    logger.info("Generating response")

    # Determine next conversation-specific instruction (if any)
    # Filter events that have branching_instruction, then randomly select one
    events_with_branching = [e for e in state.new_events if e.branching_instruction]
    next_instruction = (
        random.choice(events_with_branching).branching_instruction
        if events_with_branching
        else None
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

    # Prepare the messages for the LLM call without mutating the state
    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    # Create response from LLM
    llm_response = ChatOpenAI(
        model=settings.OPENAI_MODEL,
        temperature=settings.LLM_TEMPERATURE,
        api_key=settings.OPENAI_API_KEY,
    )
    response = await llm_response.ainvoke(messages_to_send)

    # Prepare the final messages (do not persist system or instruction in state)
    messages = [AIMessage(response.content)]

    return SimulationState(
        messages=messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator,
        current_score=state.current_score,
        new_events=[],
    )


async def send_events_to_core(
    state: SimulationState, config: Optional[RunnableConfig] = None
) -> SimulationState:
    logger.debug("Sending events to core")
    room = cast(rtc.Room, config["configurable"].get("room"))
    logger.debug(
        f"Sending all events to core: {len(state.new_events)} events (both ACTIVE and PASSIVE)"
    )

    for event in state.new_events:
        logger.debug(
            f"Sending event to core: {event.event_id} (visibility: {event.visibility_type})"
        )

        event_dict=serialize_event(event)

        core_event_message = CoreEventMessageType.create(
            room_id=room.name, event_data=event_dict
        )
        await msg_event_queue.send_message(
            message_body=core_event_message.model_dump_json()
        )
    return state
