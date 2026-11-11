"""`POST /api/v1/pm-agent/runs` (CONTRACT.md §7): the run request and its result."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


class PmAgentRunRequest(BaseModel):
    #: ally-be's id for this run: the checkpoint thread and the audit trail's key.
    agent_run_id: str
    review: Literal["weekly", "monthly"] = "weekly"
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
