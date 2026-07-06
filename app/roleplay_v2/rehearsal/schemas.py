"""API + webhook schemas for roleplay v2 rehearsals (frozen contract)."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

TraineeProfile = Literal["SKILLED", "POOR", "ADVERSARIAL"]

DEFAULT_PROFILES: List[str] = ["SKILLED", "POOR", "ADVERSARIAL"]


class RehearsalStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class RehearsalConfig(BaseModel):
    trainee_profiles: List[TraineeProfile] = Field(
        default_factory=lambda: list(DEFAULT_PROFILES)
    )
    turns_per_profile: Optional[int] = Field(
        default=None,
        description="Trainee turns per profile run; None → "
        "settings.REHEARSAL_TURNS_DEFAULT (12).",
    )
    language_id: Optional[str] = None
    judge_model: Optional[str] = Field(
        default=None,
        description="Judge model id override; None → settings.REHEARSAL_JUDGE_MODEL.",
    )


class RehearsalRequest(BaseModel):
    rehearsal_id: str
    spec: Dict[str, Any]
    spec_schema_version: str = "1.0"
    config: RehearsalConfig = Field(default_factory=RehearsalConfig)


class RehearsalResponse(BaseModel):
    rehearsal_id: str
    status: str = "processing"


class RehearsalProgress(BaseModel):
    completed: int = 0
    total: int = 0


class TranscriptTurn(BaseModel):
    role: Literal["TRAINEE", "CLIENT"]
    content: str
    turn_index: int
    state_id: str
    stage_direction: Optional[str] = None


class ProfileTranscript(BaseModel):
    trainee_profile: str
    transcript: List[TranscriptTurn] = Field(default_factory=list)
    judge_scores: Dict[str, int] = Field(default_factory=dict)
    judge_notes: str = ""
    director_trace: List[Dict[str, Any]] = Field(default_factory=list)


class RehearsalResults(BaseModel):
    overall: int = 0
    dimensions: Dict[str, int] = Field(default_factory=dict)
    per_profile: Dict[str, Dict[str, int]] = Field(default_factory=dict)


class RehearsalWebhookPayload(BaseModel):
    """PATCH body for {CORE}{ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT}/{id}."""

    status: RehearsalStatus
    progress: RehearsalProgress = Field(default_factory=RehearsalProgress)
    results: Optional[RehearsalResults] = None
    report_markdown: str = ""
    transcripts: List[ProfileTranscript] = Field(default_factory=list)
    error_message: Optional[str] = None
