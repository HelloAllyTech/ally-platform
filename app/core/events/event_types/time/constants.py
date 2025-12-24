"""Data models for time-based events."""

from pydantic import BaseModel, Field

from app.core.constants import ConditionOperator


class TimeData(BaseModel):
    """Data structure for TIME detection type."""

    time: float = Field(..., description="Time threshold in seconds")
    condition: ConditionOperator = Field(
        ..., description="Condition operator (GT, LT, GTE, LTE, EQ)"
    )
