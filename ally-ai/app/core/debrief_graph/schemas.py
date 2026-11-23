"""`POST /api/v1/debrief/runs`: what ally-be sends and what it gets back
(CONTRACT.md §1 and "Changes during build")."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, ConfigDict, Field

#: The version of the ally-be <-> ally-ai wire contract for `POST /debrief/runs`
#: (CONTRACT.md "Versioning"). Bump it only for a change an older reader cannot
#: tolerate; adding an optional field is not one. A missing value means 1.
CONTRACT_VERSION = 1


class DebriefRunRequest(BaseModel):
    #: What ally-be speaks; absent (an older ally-be) reads as 1.
    contract_version: int = CONTRACT_VERSION
    run_id: str
    scenario_session_id: str
    mode: str = "live"
    resume: bool = False
    release: Optional[Dict[str, Any]] = None
    bundle: Dict[str, Any]
    #: Live prompt texts by code; None = the step's default prompt.
    prompts: Dict[str, Optional[str]] = Field(default_factory=dict)
    ceiling_usd: float
    #: Live runs: the minimum path (safety reader, writer, checks) may pass
    #: `ceiling_usd`; optional steps still keep to it.
    allow_over_ceiling: bool = False
    #: A retry from the start: 0 = the first attempt; n runs on the thread
    #: `<run_id>:retry<n>`, so it does not read back the first decision.
    attempt: int = Field(default=0, ge=0, le=5)
    #: Per-model prices; a model left out is unpriced and never runs.
    prices: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    session: Dict[str, Any] = Field(default_factory=dict)
    transcript: List[Dict[str, Any]] = Field(default_factory=list)
    context: Dict[str, Any] = Field(default_factory=dict)
    run_token: str
    gateway_url: str


class _Tolerant(BaseModel):
    """A shape ally-be reads: the fields below are what is documented and typed,
    anything else a step adds travels through untouched (`extra='allow'`), so a
    new optional field never breaks an older reader. Never `forbid` here."""

    model_config = ConfigDict(extra="allow")


class StepRecord(_Tolerant):
    """One step as it ran (ally-be `DebriefRunStepRecord`)."""

    step: Optional[str] = None
    label: str = ""
    #: done | failed | skipped
    status: str = "done"
    startedAt: Optional[str] = None
    ms: float = 0


class EvaluatorHardFail(_Tolerant):
    code: str
    evidence: str = ""


class CheckFailure(_Tolerant):
    code: str
    section: str = ""
    detail: str = ""


class DebriefCards(_Tolerant):
    """The learner's debrief: the documented sections, each optional because a
    below-bar or short debrief may leave some out. Item shapes are kept loose on
    purpose (the Writer's schema owns them); `workspace` and `bundle` stay plain
    dicts for the same reason."""

    lead: Optional[str] = None
    what_worked: List[Any] = Field(default_factory=list)
    work_on_this: List[Any] = Field(default_factory=list)
    important_moment: Optional[Any] = None
    practise_next: Optional[Any] = None


class DebriefRunResponse(BaseModel):
    #: What ally-ai speaks; ally-be warns on a version it does not know.
    contract_version: int = CONTRACT_VERSION
    status: str
    skip_reason: Optional[str] = None
    recipe_key: Optional[str] = None
    cards: Optional[DebriefCards] = None
    steps: List[StepRecord] = Field(default_factory=list)
    #: The Agent logs: each model call's exact input and full reply, and each
    #: deciding code step's inputs and results, numbered (`seq`) in order.
    logs: List[Dict[str, Any]] = Field(default_factory=list)
    #: The progress agent's reading after the code vetoes, for ally-be to store
    #: (`debrief_progress_results`). Absent when the agent did not run.
    progress: Optional[Dict[str, Any]] = None
    workspace: Dict[str, Any] = Field(default_factory=dict)
    estimated_cost_usd: float = 0.0
    fallback_rung: int = 0
    has_risk_cue: bool = False
    # Any risk cue the reader did not mark as part of the practice.
    has_alarm_risk_cue: bool = False
    learner_distress: bool = False
    revision_rounds: int = 0
    evaluator_overall: Optional[float] = None
    evaluator_hard_fails: List[EvaluatorHardFail] = Field(default_factory=list)
    check_failures: List[CheckFailure] = Field(default_factory=list)
    resumed: bool = False
    #: The debrief's language (recorded, or read from the learner's turns).
    language: Optional[str] = None
    error: Optional[str] = None
