"""Request/response models for goal-based actor evaluation of a real session."""

from typing import Dict, List, Optional

from pydantic import BaseModel, Field


class ActorEvaluationGoal(BaseModel):
    """One superadmin-configured agent test case the actor is scored against."""

    id: str
    title: str
    category: str
    description: Optional[str] = None


class ActorEvaluationTurn(BaseModel):
    """A single transcript turn. role='assistant' is the actor; 'user' the trainee."""

    role: str
    content: str


class ActorEvaluationRequest(BaseModel):
    """Payload from ally-be requesting evaluation of a real session's actor."""

    scenario_session_id: str
    transcript: List[ActorEvaluationTurn]
    goals: List[ActorEvaluationGoal]
    language: Optional[str] = None


class ActorEvaluationResponse(BaseModel):
    """Immediate ack; the result is delivered to ally-be via webhook."""

    scenario_session_id: str
    status: str = "processing"


class ActorEvaluationWebhookPayload(BaseModel):
    """Result PATCHed back to ally-be's session-evaluation webhook."""

    status: str  # COMPLETED | FAILED
    metrics: Dict[str, int] = Field(default_factory=dict)
    # Titles of goals the conversation gave no occasion to demonstrate. Still
    # present in `metrics` (so every goal stays visible in Roleplay Logs), but
    # excluded from the composite so an inapplicable goal can't drag the score.
    not_applicable: List[str] = Field(default_factory=list)
    report_markdown: str = ""
    error_message: Optional[str] = None
