import datetime
import datetime as dt
from typing import List, Optional

from langchain_core.messages import AIMessage, HumanMessage
from langchain_core.runnables import RunnableConfig

from app.core.events.base import BaseEvent, ChatMessage
from app.core.logger import logger


def convert_messages_to_chat_messages(messages) -> List[ChatMessage]:
    """Convert langchain messages to ChatMessage format"""

    chat_messages = []
    for msg in messages:
        if isinstance(msg, AIMessage):
            role = "client"
        elif isinstance(msg, HumanMessage):
            role = "counselor"
        else:
            continue  # Skip unknown message types

        chat_messages.append(
            ChatMessage(
                role=role,
                content=msg.content,
                start_time=None,
                end_time=None,
            )
        )

    return chat_messages


def serialize_event(
    event: BaseEvent, termination_event_id: str = None, termination_message: str = None
) -> dict:
    """
    Converts a BaseEvent instance into the format required by CoreEventMessageType.

    Args:
        event: The event to serialize
        termination_event_id: Optional ID of the event that triggers termination
        termination_message: Optional custom termination message
    """
    is_termination_event = (
        termination_event_id and event.event_id == termination_event_id
    )

    # Extract branching instruction content if it's a BranchingInstruction object
    branch_instruction_value = None
    if event.branching_instruction:
        # BranchingInstruction object has a 'content' field with the
        # current instruction text
        branch_instruction_value = event.branching_instruction.content

    return {
        "id": event.event_id,
        "score": event.score or 0,
        "emoji": event.emoji or None,
        "visibilityType": event.visibility_type or None,
        "message": event.emoji_message or None,
        "branchInstruction": branch_instruction_value,
        "sentences": getattr(event, "sentences", []),
        "feedbackStatus": bool(getattr(event, "show_feedback", True)),
        "autoTerminationStatus": is_termination_event,
        "terminationMessage": termination_message if is_termination_event else None,
    }


def calculate_elapsed_time(config: Optional[RunnableConfig]) -> float:
    """Calculates *active* seconds since the agent joined (excluding paused
    time), handling timezone and format safety."""
    if not config or "configurable" not in config:
        return 0.0

    # Prefer the pause-aware session clock when present so event eligibility
    # uses active time, not wall-clock that keeps advancing during a pause.
    session_clock = config["configurable"].get("session_clock")
    if session_clock is not None:
        return session_clock.elapsed()

    joined_at_raw = config["configurable"].get("agent_joined_at")
    if not joined_at_raw:
        return 0.0

    try:
        # FIX: Use dt.datetime and dt.timezone explicitly
        now_utc = dt.datetime.now(dt.timezone.utc)

        # Parse based on type
        joined_time = None
        if isinstance(joined_at_raw, str):
            joined_time = dt.datetime.fromisoformat(joined_at_raw)
        elif isinstance(joined_at_raw, dt.datetime):
            joined_time = joined_at_raw

        if joined_time is None:
            return 0.0

        # Ensure UTC consistency
        if joined_time.tzinfo is None:
            joined_time = joined_time.replace(tzinfo=dt.timezone.utc)

        return max(0.0, (now_utc - joined_time).total_seconds())

    except ValueError:
        logger.warning(f"Failed to parse agent_joined_at: {joined_at_raw}")
        return 0.0


def get_live_score(config: Optional[RunnableConfig]) -> int:
    """
    Retrieves the committed event score from ScoreKeeper.
    Falls back to 0 if ScoreKeeper is not in config.
    """
    if config and "configurable" in config:
        score_keeper = config["configurable"].get("score_keeper")
        if score_keeper is not None:
            return score_keeper.event_score

    return 0


def is_event_eligible(
    event: "BaseEvent",
    elapsed_time: float,
    current_score: int,
    last_occurred_at: Optional[datetime] = None,
    occurrence_count: int = 0,
) -> bool:
    """Checks if the event is valid within the current time and score windows."""
    config = event.detection_config
    if not config:
        return True

    # 1. Check Time Window
    # Default: Start=0, End=Infinity
    start = config.start_time if config.start_time is not None else 0
    end = config.end_time if config.end_time is not None else float("inf")

    if not (start <= elapsed_time <= end):
        return False

    # 2. Check Score Window
    # Default: Min=-Inf, Max=+Inf
    min_s = config.min_score if config.min_score is not None else float("-inf")
    max_s = config.max_score if config.max_score is not None else float("inf")

    if not (min_s <= current_score <= max_s):
        return False

    # 3. Check Min Gap Time (Cooldown)
    if config.min_gap_time is not None and last_occurred_at is not None:
        # Calculate seconds since last occurrence
        now_utc = dt.datetime.now(dt.timezone.utc)
        time_since_last = (now_utc - last_occurred_at).total_seconds()

        if time_since_last < config.min_gap_time:
            # Cooldown hasn't finished yet
            return False

    # 4. Check Max Occurrences
    if config.max_occurrences is not None:
        if occurrence_count >= config.max_occurrences:
            return False

    return True
