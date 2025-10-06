from abc import ABC, abstractmethod
from typing import ClassVar, List, Optional

from pydantic import BaseModel, Field

from app.core.events.schemas import ChatMessage


class BaseEvent(BaseModel, ABC):
    """
    Runtime event instance populated from scenario metadata.
    Concrete subclasses must set `event_id` (ClassVar) and implement `detect_event`.
    """

    # Class-level identifier used for registry mapping (e.g., "counselor-rephrased")
    event_id: ClassVar[str]

    # Per-scenario values (come from metadata)
    score: int
    emoji: str
    emoji_message: str
    branching_instruction: str

    model_config = {"arbitrary_types_allowed": True}

    @abstractmethod
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detects the event from the given conversations.

        :param conversations: List of chat messages
        :return: True if the event is detected, False otherwise
        """
        ...
