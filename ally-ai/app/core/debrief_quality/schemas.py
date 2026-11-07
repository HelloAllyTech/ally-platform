"""Schemas for the debrief-quality judge.

Asks one question of a whole debrief: **how good is it, as a debrief?** The
feedback-groundedness judge asks whether each claim is true; this one asks
whether the debrief is specific, actionable, safe and well prioritised. It is
the independent judge the 8-out-of-10 bar is read from.

The judge emits ONLY a 0-10 score per rubric dimension and a list of hard-fail
labels. The weighted overall, the hard-fail cap and every rate are computed in
ally-be, so the weights can be re-cut without re-judging the corpus — the same
division of labour as the other judges.
"""

from __future__ import annotations

from typing import List, Literal

from pydantic import BaseModel, Field

# The rubric's dimensions. Their weights live in ally-be, next to the overall
# they produce, not here: changing a weight must never need a re-judge.
Dimension = Literal[
    "evidence_specificity",
    "accuracy",
    "actionability",
    "prioritisation",
    "personalisation_progress",
    "practice_alignment",
    "tone",
    "clarity",
]

# Failures that cap the overall at 4 whatever the other scores say.
HardFail = Literal[
    "fabricated_quote",
    "missed_risk_cue",
    "diagnoses_trainee",
    "wrong_language",
    "contradicts_protocol",
    "unsupported_progress_claim",
]


class DimensionScore(BaseModel):
    dimension: Dimension
    score: int = Field(ge=0, le=10, description="0-10 against the rubric.")
    reasoning: str = Field(description="One sentence justifying the score.")


class HardFailFinding(BaseModel):
    code: HardFail
    evidence: str = Field(
        description="The debrief text or transcript turn that shows the failure."
    )


class RiskCue(BaseModel):
    """One client statement in the transcript that signals risk."""

    turn_index: int
    quote: str = Field(description="The client's words, as in the transcript.")
    addressed_by_debrief: bool = Field(
        description="Does the debrief name this moment and how the trainee responded?"
    )


class DebriefQualityOutput(BaseModel):
    """Exactly what the judge LLM returns."""

    # Listed BEFORE the scores so the model reads the transcript for risk first.
    # A risk cue the debrief leaves out is the most serious failure a debrief
    # can have, and asking for it only as a hard-fail code let it slip by when
    # the debrief simply omitted the moment.
    risk_cues: List[RiskCue] = Field(default_factory=list)
    dimensions: List[DimensionScore]
    hard_fails: List[HardFailFinding] = Field(default_factory=list)
