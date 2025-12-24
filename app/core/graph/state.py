from typing import Annotated, Callable, Iterable, List, Tuple, TypeVar

from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages
from pydantic import BaseModel

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


def add_branching_instructions(
    left: List[Tuple[str, int]], right: List[Tuple[str, int]]
) -> List[Tuple[str, int]]:
    """Reducer to accumulate or clear branching instructions.

    When multiple events (especially time-based events during initialization)
    update the state with branching instructions, we need to accumulate them
    all rather than replacing. However, when the generate_response node clears
    them by passing an empty list, we should replace (clear) them.

    Logic:
    - If right is empty: replace (clear) the instructions
    - If right has items: accumulate with left
    """
    if not right:
        return right  # Clear: replace with empty list
    return left + right  # Accumulate: add new instructions to existing ones


class SimulationState(BaseModel):
    messages: Annotated[List[AnyMessage], add_messages]
    permitted_events: Annotated[List[BaseEvent], add_permitted_events]
    events_accumulator: Annotated[
        List[Tuple[str, BaseEvent]], add_events_accumulator
    ]  # Tuple -> (timestamp, BaseEvent)
    new_events: Annotated[List[BaseEvent], add_new_events]
    current_score: Annotated[int, add_scores]
    branching_instructions: Annotated[
        List[Tuple[str, int]], add_branching_instructions
    ]  # Tuple -> (instruction, score)
