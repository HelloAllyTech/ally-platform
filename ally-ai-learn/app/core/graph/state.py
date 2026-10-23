from dataclasses import dataclass
from typing import Annotated, Callable, Iterable, List, Optional, Tuple, TypeVar, Union

from langchain_core.messages import AnyMessage
from langgraph.graph import add_messages
from pydantic import BaseModel

from app.core.branching_instructions.base import BranchingInstruction
from app.core.events.base import BaseEvent
from app.core.scenario.simulation_instructions import SimulationBehaviorCategory

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
    event_id: str


def add_branching_and_feedback_data(
    left: List[BranchingAndFeedbackData],
    right: Union[List[BranchingAndFeedbackData], None],
) -> List[BranchingAndFeedbackData]:
    """
    Reducer for `branching_and_feedback_data` that handles accumulation and clearing.

    Behaviors:
    1. No-op: If `right` is an empty list `[]`, return `left` unchanged.
       This handles the case where a subgraph node didn't return this field —
       LangGraph passes `[]` for missing Annotated list fields, and we must NOT
       clear existing data in that case.
    2. Clear State: If `right` is `None`, reset to an empty list.
       Nodes that intentionally want to clear must pass `None`, not `[]`.
    3. Accumulate & Deduplicate: If `right` contains data, merge with `left`
       and deduplicate by `event_id` (keeping first occurrence).

    Args:
        left: The existing list of data in the state.
        right: New data to merge, `None` to clear, or `[]` for no-op.

    Returns:
        List[BranchingAndFeedbackData]: The unified, deduplicated list.
    """
    if right is None:
        return []
    if not right:
        return left
    return unique_by(left + right, key=lambda x: x.event_id)


def add_non_branching_feedback_data(
    left: List[BranchingAndFeedbackData],
    right: Union[List[BranchingAndFeedbackData], None],
) -> List[BranchingAndFeedbackData]:
    """
    Reducer for non-branching feedback data.

    Behaviors:
    1. No-op: If `right` is an empty list `[]`, return `left` unchanged.
       Handles subgraph nodes that didn't return this field.
    2. Clear State: If `right` is `None`, reset to an empty list.
       Nodes that intentionally want to clear must pass `None`, not `[]`.
    3. Accumulate & Deduplicate: If `right` contains data, merge with `left`
       and deduplicate by `event_id`.

    Args:
        left: Existing non-branching feedback data in state
        right: New data to add, `None` to clear, or `[]` for no-op.

    Returns:
        List[BranchingAndFeedbackData]: The unified, deduplicated list.
    """
    if right is None:
        return []
    if not right:
        return left
    return unique_by(left + right, key=lambda x: x.event_id)


@dataclass
class BehaviorInstructionFeedbackData:
    """
    Data structure for detected behavior instruction feedback.

    Stores the result of behavior detection for a single behavior instruction.
    Used to send score updates to UI (with empty emoji/feedback) and to BE
    (as behavior_instruction type, distinct from event type).
    """

    behavior_instruction_id: Optional[str]  # ID from core service
    score: int  # Score for this behavior instruction
    category: "SimulationBehaviorCategory"  # SHOULD_DO or SHOULD_NOT_DO


def add_behavior_feedback_data(
    left: List[BehaviorInstructionFeedbackData],
    right: Union[List[BehaviorInstructionFeedbackData], None],
) -> List[BehaviorInstructionFeedbackData]:
    """
    Reducer for behavior_feedback_data.

    Behaviors:
    1. No-op: If `right` is an empty list `[]`, return `left` unchanged.
       This handles the case where a subgraph node (e.g. resolve_branching_instruction)
       didn't return this field — LangGraph passes `[]` for missing Annotated list
       fields, and we must NOT clear existing data in that case.
    2. Clear State: If `right` is `None`, reset to an empty list.
       Nodes that intentionally want to clear must pass `None`, not `[]`.
    3. Replace: If `right` contains data, replace `left` with `right`.
       This prevents double-accumulation when subgraphs propagate their full state
       back to the parent graph — the parent reducer would otherwise run
       add(parent_current, subgraph_output), doubling the list at every subgraph
       boundary.
    """
    if right is None:
        return []
    if not right:
        return left
    return right


def replace_next_instruction(_: Optional[str], right: Optional[str]) -> Optional[str]:
    """
    Reducer to replace next_instruction.

    Always replaces with the new value (right).
    This allows nodes to set or clear the instruction.
    """
    return right


def replace_retrieved_context(_: Optional[str], right: Optional[str]) -> Optional[str]:
    """
    Reducer to replace retrieved_context.

    Always replaces with the new value (right).
    This allows nodes to set or clear the retrieved knowledge context.
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


def replace_advancing_behaviour_ids(_: List[str], right: List[str]) -> List[str]:
    """
    Reducer to replace advancing_behaviour_ids.

    Always replaces with the new value (right), unlike behavior_feedback_data's
    reducer — there is no "missing key means untouched" ambiguity to guard
    against here, since resolve_branching_instruction is the only writer and
    always sets this fresh every turn it runs.
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
    - Non-branching feedback data (processed asynchronously, doesn't block)
    - Behavior feedback data (from detect_behaviors node)
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
    ]  # Only branching events (with branching_instruction, processed sequentially)
    non_branching_feedback_data: Annotated[
        List[BranchingAndFeedbackData], add_non_branching_feedback_data
    ] = []  # Non-branching events (feedback only, processed asynchronously)
    next_instruction: Annotated[Optional[str], replace_next_instruction] = (
        None  # Resolved branching instruction for LLM
    )
    feedback_to_send: Annotated[Optional[EventFeedback], replace_feedback_to_send] = (
        None  # Feedback to send to UI
    )
    behavior_feedback_data: Annotated[
        List[BehaviorInstructionFeedbackData], add_behavior_feedback_data
    ] = []  # Behavior detection results (from detect_behaviors node)
    retrieved_context: Annotated[Optional[str], replace_retrieved_context] = (
        None  # Retrieved knowledge context for prompt enrichment
    )
    # SHOULD_DO behaviour ids that advanced the score this turn, captured by
    # resolve_branching_instruction from behavior_feedback_data before its
    # fan-out to send_event_feedback, which unconditionally clears that field.
    # update_working_memory runs several supersteps later (after
    # publish_done_thinking) and would otherwise always see it already reset.
    advancing_behaviour_ids: Annotated[List[str], replace_advancing_behaviour_ids] = []
    # NOTE: the rolling summary (episodic memory) deliberately does NOT live in
    # graph state — it is held in the worker-owned RollingSummaryStore (see
    # app/core/graph/rolling_summary.py) and passed via config, so background
    # compaction never touches checkpoints and the summary survives a cancelled
    # final graph run. The knowledge-retrieval refresh countdown was moved to
    # RetrievedContextStore.turns_until_refresh (app/core/graph/knowledge_retrieval.py)
    # for the same reason — a barge-in-cancelled superstep could silently
    # discard a decrement here before it ever survived a checkpoint commit.
