"""Function to extract the last helper (AI) utterance from conversation state."""

from typing import List, Optional

from langchain_core.messages import BaseMessage, HumanMessage

from app.core.branching_instructions.constants import ReservedBranchingVariable
from app.utils.logger import get_logger

logger = get_logger(__name__)


def get_last_helper_utterance(messages: List[BaseMessage]) -> Optional[str]:
    """
    Extracts the content of the most recent AI message from the state.

    Args:
        messages: The current simulation message history.

    Returns:
        The content string of the last AI message, or None if no AI message is found.
    """
    if not messages:
        return None

    for message in reversed(messages):
        if isinstance(message, HumanMessage):
            return str(message.content)

    return None


def resolve_last_helper_utterance(content: str, messages: List[BaseMessage]) -> str:
    """
    Specific logic to replace the <last_helper_utterance> tag.
    """
    last_utterance = get_last_helper_utterance(messages)

    if last_utterance:

        tag_to_replace = ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value

        logger.debug(f"Substituted {tag_to_replace} with: '{last_utterance[:30]}...'")
        return content.replace(f"<{tag_to_replace}>", last_utterance)

    logger.warning(
        f"Instruction contains "
        f"{ReservedBranchingVariable.LAST_HELPER_UTTERANCE.value}, "
        "but no previous helper message was found. Returning raw instruction."
    )
    return content
