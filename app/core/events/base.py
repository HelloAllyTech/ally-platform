from abc import ABC, abstractmethod
from typing import ClassVar, List, Optional

from pydantic import BaseModel, Field

from app.core.constants import VisibilityType
from app.core.events.schemas import ChatMessage


class BaseEvent(BaseModel, ABC):
    """
    Runtime event instance populated from scenario metadata.
    Concrete subclasses must set `event_id` (ClassVar) and implement `detect_event`.
    """

    # Class-level identifier used for registry mapping (e.g., "counselor-rephrased")
    event_id: ClassVar[str]
    
    # Class-level visibility type (can be overridden by subclasses)
    visibility_type: ClassVar[VisibilityType] = VisibilityType.ACTIVE

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
