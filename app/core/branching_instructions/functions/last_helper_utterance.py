"""Function to extract the last helper (AI) utterance from conversation state."""

from typing import Optional

from langchain_core.messages import AIMessage

from app.core.graph.state import SimulationState


def get_last_helper_utterance(state: SimulationState) -> Optional[str]:
    """
    Extract the last AI (helper) message from conversation state.

    Args:
        state: Current simulation state

    Returns:
        Content of last AI message, or None if no AI messages exist

    Example:
        >>> state = SimulationState(messages=[
        ...     HumanMessage(content="Hello"),
        ...     AIMessage(content="Hi there!"),
        ...     HumanMessage(content="How are you?"),
        ... ])
        >>> get_last_helper_utterance(state)
        "Hi there!"
    """
    if not state.messages:
        return None

    for message in reversed(state.messages):
        if isinstance(message, AIMessage):
            return message.content

    return None
