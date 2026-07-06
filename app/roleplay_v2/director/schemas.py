"""Structured-output schemas for the v2 Director verdict.

These models are the ``with_structured_output(..., method="json_mode")``
target for the Director LLM (same pattern as
app/core/scenario_report/evaluator.py). Field names are snake_case in the
JSON — the Director prompt spells the exact shape out explicitly.

Everything the LLM proposes here is ADVISORY: DirectorService._apply
re-validates every transition, unlock, and event firing in code before any
of it touches the RuntimeStateStore.
"""

from __future__ import annotations

from typing import List, Optional

from pydantic import BaseModel, Field, field_validator


class BehaviorObservation(BaseModel):
    """Did the trainee's latest message exhibit one rubric behavior?"""

    behavior_id: str
    observed: bool = False
    evidence: str = ""


class GuardEvaluation(BaseModel):
    """The Director's ruling on one transition guard of the current state."""

    transition_id: str
    satisfied: bool = False
    reason: str = ""


class DirectorVerdict(BaseModel):
    """One turn's complete Director ruling."""

    turn_index: int = 0
    behavior_observations: List[BehaviorObservation] = Field(default_factory=list)
    guard_evaluations: List[GuardEvaluation] = Field(default_factory=list)
    next_state_id: Optional[str] = None
    unlock_ids: List[str] = Field(default_factory=list)
    fire_event_ids: List[str] = Field(default_factory=list)
    stage_direction: Optional[str] = None
    retrieve_topics: List[str] = Field(default_factory=list)
    trainee_feedback: Optional[str] = None
    confidence: float = 0.0

    @field_validator("confidence")
    @classmethod
    def _clamp_confidence(cls, v: float) -> float:
        return max(0.0, min(1.0, v))

    def observed_behavior_ids(self) -> List[str]:
        """Ids the Director marked observed (order-preserving, de-duplicated)."""
        seen: set[str] = set()
        out: List[str] = []
        for obs in self.behavior_observations:
            if obs.observed and obs.behavior_id not in seen:
                seen.add(obs.behavior_id)
                out.append(obs.behavior_id)
        return out

    def satisfied_guard_ids(self) -> set[str]:
        return {g.transition_id for g in self.guard_evaluations if g.satisfied}
