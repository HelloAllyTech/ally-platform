"""Function to extract the last helper (AI) utterance from conversation state."""

from typing import Optional


def get_last_helper_utterance() -> Optional[str]:
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
    return None
