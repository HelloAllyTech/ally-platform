"""Data models for utterance length-based events."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UtteranceLengthData(BaseModel):
    """Data structure for HELPER_UTTERANCE_LENGTH detection type."""

    min_utterance_length: Optional[int] = Field(
        alias="minUtteranceLength",
        default=0,
        description="Minimum character count (inclusive)",
    )
    max_utterance_length: Optional[int] = Field(
        alias="maxUtteranceLength",
        default=None,
        description="Maximum character count (inclusive)",
    )

    def __init__(self, **data):
        super().__init__(**data)
        # Validate that minUtteranceLength <= maxUtteranceLength if both are provided
        if (
            self.min_utterance_length is not None
            and self.max_utterance_length is not None
            and self.min_utterance_length > self.max_utterance_length
        ):
            raise ValueError(
                "minUtteranceLength must be less than or equal to maxUtteranceLength"
            )

    model_config = ConfigDict(populate_by_name=True)
