from abc import ABC, abstractmethod
from typing import List, Optional

from pydantic import BaseModel

from app.core.constants import VisibilityType
from app.core.events.schemas import ChatMessage


class BaseEvent(BaseModel, ABC):
    """
    Runtime event instance populated from scenario metadata.
    Concrete subclasses must implement `detect_event`.
    """

    # Instance-level event identifier
    event_id: str
    
    # Instance-level visibility type
    visibility_type: VisibilityType = VisibilityType.ACTIVE

    # Per-scenario values (come from metadata)
    score: Optional[int] = None
    emoji: Optional[str] = None
    emoji_message: Optional[str] = None
    branching_instruction: Optional[str] = None

    model_config = {"arbitrary_types_allowed": True}

    @abstractmethod
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detects the event from the given conversations.

        :param conversations: List of chat messages
        :return: True if the event is detected, False otherwise
        """
        ...
