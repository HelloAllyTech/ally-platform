"""Data models for utterance length-based events."""

from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class UtteranceLengthData(BaseModel):
    """Data structure for HELPER_UTTERANCE_LENGTH detection type."""

    min_length: Optional[int] = Field(
        0, alias="minLength", description="Minimum character count (inclusive)"
    )
    max_length: Optional[int] = Field(
        None, alias="maxLength", description="Maximum character count (inclusive)"
    )

    def __init__(self, **data):
        super().__init__(**data)
        # Validate that min_length <= max_length if both are provided
        if (
            self.min_length is not None
            and self.max_length is not None
            and self.min_length > self.max_length
        ):
            raise ValueError("min_length must be less than or equal to max_length")

    model_config = ConfigDict(populate_by_name=True)
