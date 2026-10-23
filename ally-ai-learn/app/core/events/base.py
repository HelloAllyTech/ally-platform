from abc import ABC, abstractmethod
from typing import Any, List, Optional

from pydantic import BaseModel, Field

from app.core.branching_instructions.base import BranchingInstruction
from app.core.constants import DetectionType, VisibilityType


class ChatMessage(BaseModel):
    role: str = Field(
        ..., description="The role of the sender (e.g., user, assistant, counselor)"
    )
    content: str = Field(..., description="The content of the message")
    start_time: Optional[float] = Field(
        None, description="Start time of the message in seconds (relative position)"
    )
    end_time: Optional[float] = Field(
        None, description="End time of the message in seconds (relative position)"
    )
    interrupted: Optional[bool] = Field(
        None,
        description=(
            "For a CLIENT turn: the learner talked over it, so `content` is only "
            "the part of the reply that reached TTS before it stopped — not what "
            "the model produced. Measured across judged turns, a cut turn keeps "
            "about 36% of the generated characters against 107% on an uncut one. "
            "None means unknown (an older worker, or a COUNSELOR turn), which is "
            "deliberately distinct from False."
        ),
    )
    utterance_kind: Optional[str] = Field(
        None,
        description=(
            "Which KIND of client utterance this line is: 'reply' (the real, "
            "generated reply), 'filler' (a thinking filler — a short "
            "back-channel spoken while the reply was still forming) or "
            "'interim' (a non-committal holding reply). All three arrive as "
            "CLIENT lines and a single turn can produce all three in a row, so "
            "without this a consumer cannot tell them apart except by guessing "
            "from position — and position is ambiguous the moment a "
            "continuation filler plays. Values match the "
            "`metadata.firstAudioSource` vocabulary on the turn-metrics row, so "
            "the transcript and the latency record can be joined. "
            "None means unknown (an older worker, or a COUNSELOR turn), "
            "deliberately distinct from 'reply'."
        ),
    )

    class Config:
        json_schema_extra = {
            "example": {
                "role": "counselor",
                "content": "Hello, how are you?",
                "start_time": 0.5,
                "end_time": 5.7,
                "interrupted": False,
                "utterance_kind": None,
            }
        }


class DetectionConfig(BaseModel):
    """
    Configuration settings for when and how the event should be detected.
    """

    start_time: Optional[float] = Field(
        None, description="The start time window (in seconds) for detection."
    )
    end_time: Optional[float] = Field(
        None, description="The end time window (in seconds) for detection."
    )
    min_score: Optional[int] = Field(
        None, description="Minimum score required to trigger."
    )
    max_score: Optional[int] = Field(
        None, description="Maximum score allowed to trigger."
    )
    min_gap_time: Optional[float] = Field(
        None,
        description="Minimum time (seconds) that must pass"
        " since this event's last occurrence.",
    )
    max_occurrences: Optional[int] = Field(
        None, description="Maximum number of times this event can trigger."
    )
    occurrence_interval: Optional[int] = Field(
        None,
        description=(
            "Event triggers only when occurrence count is a multiple of this value."
        ),
    )


class BaseEvent(BaseModel, ABC):
    """
    Runtime event instance populated from scenario metadata.
    Concrete subclasses must implement `detect_event`.
    """

    # Instance-level event identifier
    event_id: str

    # Instance-level visibility type
    visibility_type: VisibilityType = VisibilityType.ACTIVE

    # Detection type and data (optional for backward compatibility)
    # Default to SENTENCE_SIMILARITY with empty sentences list
    detection_type: DetectionType = DetectionType.SENTENCE_SIMILARITY
    data: Any = Field(default_factory=lambda: {})

    # Per-scenario values (come from metadata)
    score: Optional[int] = None
    emoji: Optional[str] = None
    emoji_message: Optional[str] = None
    branching_instruction: Optional[BranchingInstruction] = None
    show_feedback: Optional[bool] = True

    detection_config: Optional[DetectionConfig] = Field(default_factory=DetectionConfig)

    model_config = {"arbitrary_types_allowed": True}

    @abstractmethod
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detects the event from the given conversations.

        :param conversations: List of chat messages
        :return: True if the event is detected, False otherwise
        """
        ...
