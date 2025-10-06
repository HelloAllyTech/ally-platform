import asyncio
from datetime import datetime, timezone
from typing import Optional, cast, List

from langchain_core.messages import AIMessage
from langchain_core.runnables import RunnableConfig
from langchain_openai import ChatOpenAI
from livekit import rtc

from app.core.config import settings
from app.core.events.base import ChatMessage, BaseEvent
from app.core.events.core_event_sender import CoreEventMessageType
from app.core.events.ui_event_sender import send_event, CustomUIEventMessageType
from app.core.graph.prompt import generate_system_message
from app.core.graph.state import SimulationState
from app.core.graph.utils import convert_messages_to_chat_messages
from app.core.queue import msg_event_queue
from app.core.scenario.base import Scenario
from app.utils.logger import logger


async def process_events(state: SimulationState, config: Optional[RunnableConfig] = None) -> SimulationState:
    """Process events in the state (async version, detect_event is async)"""

    async def detect_single_event(event: BaseEvent, chat_messages: List[ChatMessage]):
        if await event.detect_event(chat_messages):  # async call
            return event
        return None

    chat_messages = convert_messages_to_chat_messages(state.messages)
    tasks = [asyncio.create_task(detect_single_event(e, chat_messages)) for e in state.permitted_events]

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

    return SimulationState(
        messages=state.messages,
        permitted_events=state.permitted_events,
        events_accumulator=state.events_accumulator + detected_events,
        new_events=new_events,
        current_score=state.current_score,
    )


async def send_events_to_ui(state: SimulationState, config: Optional[RunnableConfig] = None) -> SimulationState:
    logger.info("Sending events to UI")
    room = cast(rtc.Room, config["configurable"].get("room"))
    logger.debug(f"New events: {state.new_events}")

    if state.new_events:
        # Calculate sum of all scores
        total_score = sum(event.score for event in state.new_events)

        # Find event with highest absolute score
        highest_abs_event = max(state.new_events, key=lambda e: abs(e.score))

        # Create single UI message with combined data
        ui_message_type = CustomUIEventMessageType.create(
            score=total_score,
            emoji=highest_abs_event.emoji,
            message=highest_abs_event.emoji_message,
            timestamp=datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")
        )
        await send_event(ui_message_type, room)

    return state


async def generate_response(state: SimulationState, config: Optional[RunnableConfig] = None) -> SimulationState:
    logger.info("Generating response")

    # Determine next conversation-specific instruction (if any)
    next_instruction = (
        max(state.new_events, key=lambda e: abs(e.score)).branching_instruction
        if state.new_events else None
    )

    # Build system message from scenario and prepend only for the LLM call
    scenario = cast(Scenario, config["configurable"].get("scenario")) if config else None
    system_message = None
    if scenario is not None:
        system_message = generate_system_message(
            about=scenario.name,
            goal=scenario.learning_objective,
            role=scenario.prompt,
            life_history=scenario.life_history,
            next_instruction=next_instruction,
        )

    # Prepare the messages for the LLM call without mutating the state
    messages_to_send = []
    if system_message is not None:
        messages_to_send.append(system_message)
    messages_to_send.extend(state.messages)

    # Create response from LLM
    llm_response = ChatOpenAI(model=settings.OPENAI_MODEL, temperature=settings.LLM_TEMPERATURE, api_key=settings.OPENAI_API_KEY)
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


async def send_events_to_core(state: SimulationState, config: Optional[RunnableConfig] = None) -> SimulationState:
    logger.debug("Sending events to core")
    room = cast(rtc.Room, config["configurable"].get("room"))
    for event in state.new_events:
        core_event_message = CoreEventMessageType.create(event_id=event.event_id, room_id=room.name)
        await msg_event_queue.send_message(message_body=core_event_message.model_dump_json())
    return state
