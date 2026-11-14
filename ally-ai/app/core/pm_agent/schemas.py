"""`POST /api/v1/pm-agent/runs` (CONTRACT.md §7): the run request and its result."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PmAgentRunRequest(BaseModel):
    #: ally-be's id for this run: the checkpoint thread and the audit trail's key.
    agent_run_id: str
    #: weekly / monthly: the analysis runs. questions: a short answer-only run,
    #: started when a person asks a question on one of the agent's ideas (plan
    #: §11.7); ally-be gives it read tools and `question_answer` only.
    review: Literal["weekly", "monthly", "questions"] = "weekly"
    #: The agent's model and its backup (priced in `prices`; an unpriced model
    #: never runs).
    model: Optional[str] = None
    backup_model: Optional[str] = None
    prices: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    #: What this run may spend on its own model calls: the smaller of the run cap and
    #: what is left of the month's learning budget, decided by ally-be.
    budget_usd: float = Field(ge=0)
    #: The live `debrief_improver_system` text; None uses the default.
    system_prompt: Optional[str] = None
    #: Everything ally-be packed for this run (spec C1): comments, metric failure
    #: points, judge/Evaluator results, learner flags, reporting library and catalogue,
    #: editable prompts and settings, last run's outcomes, budget and autonomy.
    inputs: Dict[str, Any] = Field(default_factory=dict)
    #: The tools the agent token lists; the agent is only given these.
    tools: List[str] = Field(default_factory=list)
    agent_token: str
    gateway_url: str


class PmAgentRunResponse(BaseModel):
    status: Literal["finished", "budget_spent", "failed"]
    #: The report for people, the agent's last answer.
    report: Optional[str] = None
    #: Ideas it proposed this run (ally-be ids, from `idea_propose`).
    idea_ids: List[str] = Field(default_factory=list)
    #: Our own trace (spec D6): one record per model call and tool call.
    steps: List[Dict[str, Any]] = Field(default_factory=list)
    #: The plan it kept (`write_todos`), for the run view.
    todos: List[Dict[str, Any]] = Field(default_factory=list)
    estimated_cost_usd: float = 0.0
    model: Optional[str] = None
    #: Tool calls ally-be refused, with the reason it gave.
    refusals: List[Dict[str, str]] = Field(default_factory=list)
    error: Optional[str] = None


# --- Builder's interview, answered by the PM agent (plan §11.5, FR-63) ------------


class BuilderQuestionOption(BaseModel):
    id: str
    label: str
    description: Optional[str] = None


class BuilderQuestion(BaseModel):
    #: Builder's question id (the answer goes back under it).
    id: str
    prompt: str
    rationale: Optional[str] = None
    options: List[BuilderQuestionOption] = Field(default_factory=list)


class BuilderBrief(BaseModel):
    """The PM agent's own brief for Builder: quotes already stripped by ally-be."""

    title: str
    problem: str = ""
    evidence_summary: str = ""
    expected_effect: str = ""
    acceptance_checks: List[str] = Field(default_factory=list)


class BuilderAnswersRequest(BaseModel):
    idea_id: str
    model: Optional[str] = None
    backup_model: Optional[str] = None
    prices: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    #: What this call may spend: decided by ally-be from the learning budget.
    budget_usd: float = Field(ge=0)
    brief: BuilderBrief
    questions: List[BuilderQuestion] = Field(default_factory=list, max_length=10)
    #: Text that must never reach Builder (the cited comments' bodies), stripped
    #: from every answer as well as anything in quotation marks.
    known_texts: List[str] = Field(default_factory=list)
    #: The live Skills Store prompts for this call (ally-be's `getPromptOverrides`):
    #: `ally_ai_debrief_pm_builder_answers_system`. Missing → the local default.
    prompts: Optional[Dict[str, Any]] = None


class BuilderAnswerOut(BaseModel):
    question_id: str
    #: False: the brief does not settle it, so a person answers in Builder.
    can_answer: bool
    selected_option_ids: List[str] = Field(default_factory=list)
    answer: str = ""
    reason: str = ""


class BuilderAnswersResponse(BaseModel):
    status: Literal["finished", "budget_spent", "failed"]
    answers: List[BuilderAnswerOut] = Field(default_factory=list)
    estimated_cost_usd: float = 0.0
    model: Optional[str] = None
    error: Optional[str] = None
