"""Data models for score-based events."""

from pydantic import BaseModel, Field

from app.core.constants import ConditionOperator


class ScoreData(BaseModel):
    """Data structure for SCORE detection type."""

    score: int = Field(..., description="Score threshold")
    condition: ConditionOperator = Field(
        ..., description="Condition operator (GT, LT, GTE, LTE, EQ)"
    )
