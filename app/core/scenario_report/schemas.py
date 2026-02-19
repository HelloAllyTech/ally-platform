"""Pydantic models for the scenario report generation feature."""

from enum import Enum
from typing import Any, Dict, List, Literal

from pydantic import BaseModel, Field


class ReportStatus(str, Enum):
    """Report generation status."""

    PROCESSING = "PROCESSING"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"


class ScenarioReportRequest(BaseModel):
    """Request body for POST /api/v1/scenario-report/generate."""

    prompt: str = Field(
        ...,
        description="System prompt for the counselor simulation agent",
    )
    turns: int = Field(
        ...,
        ge=1,
        description="Number of conversation turns to simulate",
    )
    language: str = Field(
        ...,
        description="BCP 47 language code (e.g., 'en-US')",
    )
    scenario_id: int = Field(..., description="Scenario identifier")
    report_id: str = Field(..., description="Unique report identifier (UUID)")
    metadata: Dict[str, Any] = Field(
        ...,
        description=(
            "Full scenario metadata envelope " "(same format as LiveKit room metadata)"
        ),
    )


class ScenarioReportResponse(BaseModel):
    """Immediate response returned when report generation is accepted."""

    scenario_id: int
    report_id: str
    status: ReportStatus = ReportStatus.PROCESSING


class TranscriptEntry(BaseModel):
    """Single transcript entry in the conversation."""

    content: str = Field(..., description="Message text content")
    start_time: float = Field(
        ...,
        description="Wall-clock start time in seconds from session start",
    )
    role: Literal["CLIENT", "COUNSELOR"] = Field(
        ..., description="Who sent this message"
    )


class ScenarioReportWebhookPayload(BaseModel):
    """Payload sent to the core backend webhook after report completion."""

    metrics: Dict[str, Any] = Field(
        ...,
        description=(
            "LLM-judge evaluation metrics: gradual_disclosure, difficulty_level, "
            "colloquialism, context_appropriateness, consistency, resistance"
        ),
    )
    status: ReportStatus = Field(..., description="Report completion status")
    transcripts: List[TranscriptEntry] = Field(
        ..., description="Full conversation transcript"
    )
