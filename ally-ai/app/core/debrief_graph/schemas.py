"""`POST /api/v1/debrief/runs`: what ally-be sends and what it gets back
(CONTRACT.md §1 and "Changes during build")."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class DebriefRunRequest(BaseModel):
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


class DebriefRunResponse(BaseModel):
    status: str
    skip_reason: Optional[str] = None
    recipe_key: Optional[str] = None
    cards: Optional[Dict[str, Any]] = None
    steps: List[Dict[str, Any]] = Field(default_factory=list)
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
    evaluator_hard_fails: List[Dict[str, Any]] = Field(default_factory=list)
    check_failures: List[Dict[str, Any]] = Field(default_factory=list)
    resumed: bool = False
    #: The debrief's language (recorded, or read from the learner's turns).
    language: Optional[str] = None
    error: Optional[str] = None
