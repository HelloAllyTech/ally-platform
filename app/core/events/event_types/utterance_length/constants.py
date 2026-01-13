"""Data models for utterance length-based events."""

from typing import Optional

from pydantic import BaseModel, Field


class UtteranceLengthData(BaseModel):
    """Data structure for HELPER_UTTERANCE_LENGTH detection type."""

    min_length: Optional[int] = Field(
        None, description="Minimum character count (inclusive)"
    )
    max_length: Optional[int] = Field(
        None, description="Maximum character count (inclusive)"
    )

    def __init__(self, **data):
        super().__init__(**data)
        # Validate that at least one limit is provided
        if self.min_length is None and self.max_length is None:
            raise ValueError(
                "At least one of min_length or max_length must be provided"
            )
        # Validate that min_length <= max_length if both are provided
        if (
            self.min_length is not None
            and self.max_length is not None
            and self.min_length > self.max_length
        ):
            raise ValueError("min_length must be less than or equal to max_length")
