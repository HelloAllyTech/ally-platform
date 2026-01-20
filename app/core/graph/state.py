from dataclasses import dataclass
from typing import Annotated, Callable, Iterable, List, Optional, Tuple, TypeVar

from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages
from pydantic import BaseModel

from app.core.branching_instructions.base import BranchingInstruction
from app.core.events.base import BaseEvent

T = TypeVar("T")
K = TypeVar("K")


def unique_by(seq: Iterable[T], key: Callable[[T], K]) -> List[T]:
    """Stable dedupe: keeps the first occurrence of each key."""
    seen: set[K] = set()
    out: List[T] = []
    for item in seq:
        k = key(item)
        if k not in seen:
            seen.add(k)
            out.append(item)
    return out


# ----------------------------
# Reducers
# ----------------------------
def add_events_accumulator(
    left: List[Tuple[str, BaseEvent]], right: List[Tuple[str, BaseEvent]]
) -> List[Tuple[str, BaseEvent]]:
    """Reducer to add events uniquely by event_id (stable, left-biased)."""
    return unique_by(left + right, key=lambda p: p[1].event_id)


def add_scores(left: int, right: int) -> int:
    """Reducer to add scores"""
    return right


def add_permitted_events(
    left: List[BaseEvent], right: List[BaseEvent]
) -> List[BaseEvent]:
    """Reducer to add permitted events uniquely by event_id (stable, left-biased)."""
    return unique_by(left + right, key=lambda e: e.event_id)


def add_new_events(left: List[BaseEvent], right: List[BaseEvent]) -> List[BaseEvent]:
    """Reducer to add new events uniquely by event_id (stable, left-biased)."""
    # return unique_by(left + right, key=lambda e: e.event_id)
    # if right:
    #     return unique_by(left + right, key=lambda e: e.event_id)
    # return []
    return right


@dataclass
class EventFeedback:
    """
    Represents feedback message data to be sent to the UI.

    This contains all the information needed to display feedback to the user,
    including emoji, message text, and visibility settings.

    Note: Score is NOT stored here - it's stored in BranchingAndFeedbackData
    and used for priority selection and cumulative score calculation.
    """

    emoji: Optional[str]  # Emoji to display (from event.emoji)
    message: Optional[str]  # Feedback message text (from event.emoji_message)
    show_feedback: bool = (
        True  # Whether to show feedback button (from event.show_feedback)
    )


@dataclass
class BranchingAndFeedbackData:
    """
    Unified event data structure that combines branching instructions and feedback.

    This structure allows us to:
    1. Store branching instructions for LLM guidance (conversation direction)
    2. Store feedback messages for UI display (user feedback)
    3. Maintain event scores for priority selection

    Priority logic:
    - If an event has a branching_instruction, it takes priority for both
      LLM guidance and UI feedback (highest score among branching events)
    - If no branching events exist, the highest score event's feedback is used
    """

    branching_instruction: Optional[
        BranchingInstruction
    ]  # For LLM guidance (conversation direction)
    feedback: Optional[EventFeedback]  # For UI display (user feedback)
    score: int  # Event score for priority selection


def add_branching_and_feedback_data(
    left: List[BranchingAndFeedbackData], right: List[BranchingAndFeedbackData]
) -> List[BranchingAndFeedbackData]:
    """
    Reducer to accumulate or clear branching and feedback data.

    When data is provided (right has items), accumulate with existing data.
    When an empty list is provided (right is empty), clear all data.

    This allows the generate_response node to clear branching_and_feedback_data
    after processing by returning an empty list.

    Args:
        left: Existing branching and feedback data in state
        right: New data to add (or empty list to clear)

    Returns:
        Accumulated data, or empty list if right was empty
    """
    if not right:
        return right  # Clear: replace with empty list
    return left + right  # Accumulate: add new data to existing ones


def replace_next_instruction(_: Optional[str], right: Optional[str]) -> Optional[str]:
    """
    Reducer to replace next_instruction.

    Always replaces with the new value (right).
    This allows nodes to set or clear the instruction.
    """
    return right


def replace_feedback_to_send(
    _: Optional[EventFeedback], right: Optional[EventFeedback]
) -> Optional[EventFeedback]:
    """
    Reducer to replace feedback_to_send.

    Always replaces with the new value (right).
    This allows nodes to set or clear the feedback.
    """
    return right


class SimulationState(BaseModel):
    """
    State model for the LangGraph simulation workflow.

    This state tracks:
    - Conversation messages
    - Events (permitted, detected, accumulated)
    - Score tracking
    - Branching and feedback data (unified structure for branching + feedback)
    - Resolved branching instruction (for LLM)
    - Feedback to send (for UI)
    """

    messages: Annotated[List[AnyMessage], add_messages]
    permitted_events: Annotated[List[BaseEvent], add_permitted_events]
    events_accumulator: Annotated[
        List[Tuple[str, BaseEvent]], add_events_accumulator
    ]  # Tuple -> (timestamp, BaseEvent)
    new_events: Annotated[List[BaseEvent], add_new_events]
    current_score: Annotated[int, add_scores]
    branching_and_feedback_data: Annotated[
        List[BranchingAndFeedbackData], add_branching_and_feedback_data
    ]  # Unified data: branching instructions + feedback messages
    next_instruction: Annotated[Optional[str], replace_next_instruction] = (
        None  # Resolved branching instruction for LLM
    )
    feedback_to_send: Annotated[Optional[EventFeedback], replace_feedback_to_send] = (
        None  # Feedback to send to UI
    )
