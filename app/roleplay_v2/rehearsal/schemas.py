"""API + webhook schemas for roleplay v2 rehearsals (frozen contract)."""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, model_validator

TraineeProfile = Literal["SKILLED", "POOR", "ADVERSARIAL"]

DEFAULT_PROFILES: List[str] = ["SKILLED", "POOR", "ADVERSARIAL"]

TestVerdict = Literal["PASSED", "FAILED", "INCONCLUSIVE"]


class RehearsalStatus(str, Enum):
    IN_PROGRESS = "IN_PROGRESS"
    COMPLETED = "COMPLETED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"


TestCaseType = Literal["condition", "full_session"]


class TestCaseRubric(BaseModel):
    """One full_session rubric row: what to judge, and how to score it."""

    __test__ = False  # name matches pytest's Test* pattern; not a test class

    criteria: str
    scoring_instructions: str = ""


class RehearsalTestCase(BaseModel):
    """Launch-time snapshot of one agent test case (self-describing, no DB)."""

    id: str
    title: str
    category: Optional[str] = None
    type: TestCaseType = "condition"
    condition: Optional[str] = None
    test: Optional[str] = None
    rubrics: List[TestCaseRubric] = Field(default_factory=list)

    @model_validator(mode="after")
    def _validate_shape_for_type(self) -> "RehearsalTestCase":
        if self.type == "condition":
            if not (self.condition or "").strip() or not (self.test or "").strip():
                raise ValueError(
                    f"condition test case {self.id!r} requires non-empty "
                    "'condition' and 'test'"
                )
        else:  # full_session
            if not any((r.criteria or "").strip() for r in self.rubrics):
                raise ValueError(
                    f"full_session test case {self.id!r} requires at least "
                    "one rubric with non-empty criteria"
                )
        return self


class RubricCriterionScore(BaseModel):
    """Judge output for one full_session rubric criterion."""

    criteria: str
    score: int = 0
    evidence: str = ""
    reasoning: str = ""


class TestCaseResult(BaseModel):
    __test__ = False  # name matches pytest's Test* pattern; not a test class

    test_case_id: str
    title: str
    case_type: TestCaseType = "condition"
    # condition-only fields (None for full_session cases):
    verdict: Optional[TestVerdict] = None
    condition_recreated: Optional[bool] = None
    evidence: str = ""
    reasoning: str = ""
    # full_session-only fields (empty/None for condition cases):
    rubric_scores: List[RubricCriterionScore] = Field(default_factory=list)
    overall_score: Optional[int] = None
    # True when the judge LLM call fell back (evaluator unavailable) — the
    # verdict/scores are placeholders, not a real evaluation. ally-be marks
    # the report row FAILED on this flag.
    judge_failed: bool = False


class RehearsalConfig(BaseModel):
    trainee_profiles: List[TraineeProfile] = Field(
        default_factory=lambda: list(DEFAULT_PROFILES)
    )
    turns_per_profile: Optional[int] = Field(
        default=None,
        description="Trainee turns per profile run; None → "
        "settings.REHEARSAL_TURNS_DEFAULT (8).",
    )
    language_id: Optional[int] = None
    judge_model: Optional[str] = Field(
        default=None,
        description="Judge model id override; None → settings.REHEARSAL_JUDGE_MODEL.",
    )
    trainee_model: Optional[str] = Field(
        default=None,
        description="Trainee model id override; None → "
        "settings.REHEARSAL_TRAINEE_MODEL (empty → default app LLM).",
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
    unit_report_markdown: str = ""


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
