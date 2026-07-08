"""API + webhook schemas for roleplay v2 rehearsals (frozen contract)."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

TraineeProfile = Literal["SKILLED", "POOR", "ADVERSARIAL"]

DEFAULT_PROFILES: List[str] = ["SKILLED", "POOR", "ADVERSARIAL"]

TestVerdict = Literal["PASSED", "FAILED", "INCONCLUSIVE"]


class RehearsalStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


class RehearsalTestCase(BaseModel):
    """Launch-time snapshot of one agent test case (self-describing, no DB)."""

    id: str
    title: str
    category: Optional[str] = None
    condition: str
    test: str


class TestCaseResult(BaseModel):
    test_case_id: str
    title: str
    verdict: TestVerdict
    condition_recreated: bool
    evidence: str = ""
    reasoning: str = ""


class RehearsalConfig(BaseModel):
    trainee_profiles: List[TraineeProfile] = Field(
        default_factory=lambda: list(DEFAULT_PROFILES)
    )
    turns_per_profile: Optional[int] = Field(
        default=None,
        description="Trainee turns per profile run; None → "
        "settings.REHEARSAL_TURNS_DEFAULT (12).",
    )
    language_id: Optional[int] = None
    judge_model: Optional[str] = Field(
        default=None,
        description="Judge model id override; None → settings.REHEARSAL_JUDGE_MODEL.",
    )
    test_cases: List[RehearsalTestCase] = Field(
        default_factory=list,
        description="Agent test-case snapshots to rehearse, one session each.",
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
    test_case_id: Optional[str] = None
    test_case_title: Optional[str] = None
    test_result: Optional[TestCaseResult] = None


class RehearsalResults(BaseModel):
    overall: int = 0
    dimensions: Dict[str, int] = Field(default_factory=dict)
    per_profile: Dict[str, Dict[str, int]] = Field(default_factory=dict)
    test_case_results: List[TestCaseResult] = Field(default_factory=list)
    test_counts: Dict[str, int] = Field(default_factory=dict)
    test_pass_rate: Optional[int] = None


class RehearsalWebhookPayload(BaseModel):
    """PATCH body for {CORE}{ROLEPLAY_REHEARSAL_WEBHOOK_ENDPOINT}/{id}."""

    status: RehearsalStatus
    progress: RehearsalProgress = Field(default_factory=RehearsalProgress)
    results: Optional[RehearsalResults] = None
    report_markdown: str = ""
    transcripts: List[ProfileTranscript] = Field(default_factory=list)
    error_message: Optional[str] = None
