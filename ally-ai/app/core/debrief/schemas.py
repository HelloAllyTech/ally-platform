"""Shapes the debrief agent's AI steps exchange with ally-be's recipe runner.

ally-be owns the run and stores every one of these in the run's workspace; the
steps here are stateless. Field names are the wire names ally-be reads, so a
rename here is a contract change on both sides.
"""

from __future__ import annotations

from typing import List, Literal, Optional

from pydantic import BaseModel, Field

from app.core.debrief_quality.schemas import (
    DimensionScore,
    HardFailFinding,
)
from app.core.debrief_quality.schemas import RiskCue as JudgeRiskCue

# --- Analyst: the evidence map ---------------------------------------------

Observation = Literal["observed", "partial", "missed"]
Confidence = Literal["low", "medium", "high"]


class BehaviourEvidence(BaseModel):
    skill: str = Field(
        description="The helping skill or expected behaviour, in a few words."
    )
    opportunity: bool = Field(
        description="Was there a real chance to use this skill in this session?"
    )
    observation: Observation
    confidence: Confidence
    importance: int = Field(
        ge=1, le=3, description="3 = mattered most in this session."
    )
    turn_index: Optional[int] = Field(
        default=None,
        description="The counsellor turn that shows it; null if missed outright.",
    )
    quote: Optional[str] = Field(
        default=None, description="Exact words from that turn, as written."
    )
    note: str = Field(description="One sentence: what happened and why it mattered.")
    coverage_category: Optional[
        Literal["Listening Engagement", "Emotional Attunement", "Supportive Engagement"]
    ] = Field(
        default=None,
        description=(
            "Which of the three skill-coverage areas this behaviour belongs to: "
            "Listening Engagement (listening and engaging with what the client "
            "said), Emotional Attunement (recognising and responding to the "
            "client's emotions) or Supportive Engagement (offering support and a "
            "safe, non-judgmental space). Null if none fits."
        ),
    )
    detector_agreement: Optional[Literal["agrees", "disagrees"]] = Field(
        default=None,
        description=(
            "Only when LIVE DETECTIONS lists this skill: whether your reading "
            "agrees with what the live detector recorded. Null otherwise."
        ),
    )


class PivotalMoment(BaseModel):
    turn_index: int
    summary: str = Field(
        description=(
            "What was going on, in your own words and WITHOUT quoting anyone. "
            "Used to look up practice guidance, so name the situation and skill."
        )
    )
    why_it_matters: str


class AiFault(BaseModel):
    turn_index: int
    note: str = Field(
        description="What the AI client did wrong. Never the learner's fault."
    )


class EvidenceMap(BaseModel):
    behaviours: List[BehaviourEvidence] = Field(default_factory=list)
    pivotal_moments: List[PivotalMoment] = Field(default_factory=list)
    emotional_arc: str = ""
    ai_faults: List[AiFault] = Field(default_factory=list)
    detected_language: str = Field(
        default="", description="ISO 639-1 code of the counsellor's main language."
    )


# --- Progress reader -----------------------------------------------------------

Trend = Literal["more_consistent", "about_the_same", "too_early"]


class ProgressItem(BaseModel):
    skill: str
    trend: Trend
    evidence: str = Field(
        description="What in this session supports the trend. Empty for too_early."
    )
    follows_up_point: Optional[str] = Field(
        default=None, description="The past Work-on-this point this answers, verbatim."
    )


class ProgressReading(BaseModel):
    items: List[ProgressItem] = Field(default_factory=list)


# --- Writer / Reviser: the cards ----------------------------------------------

SkillWord = Literal["strength", "keep_practising", "didnt_come_up"]


class OtherMoment(BaseModel):
    turn_index: int
    quote: str = Field(description="The client's words, exactly as in the transcript.")
    note: str = Field(
        description="One sentence, at most 30 words: how the trainee responded to it."
    )


class ImportantMomentCard(BaseModel):
    turn_index: int
    quote: str = Field(description="The client's words, exactly as in the transcript.")
    handled_well: bool
    lead: str = Field(description="At most 25 words, in Ally's voice.")
    body: str = Field(description="At most 60 words.")
    others: List[OtherMoment] = Field(
        default_factory=list,
        description=(
            "Every OTHER risk cue in the safety reading, one entry each, so no "
            "cue goes unmentioned. Empty when there is only one."
        ),
    )


class WorkedCard(BaseModel):
    skill: str
    turn_index: int
    quote: str = Field(
        description="The counsellor's words, exactly as in the transcript."
    )
    lead: str
    body: str


class WorkOnThisCard(BaseModel):
    skill: str
    turn_index: int
    quote: str = Field(description="Words from the transcript, exactly as written.")
    lead: str
    why: str = Field(description="Why it mattered, at most 40 words.")
    try_saying: str = Field(description="One thing the counsellor could say next time.")
    scenario_id: Optional[int] = Field(
        default=None,
        description="A roleplay from PRACTICE OPTIONS for this skill, or null.",
    )


class PractiseNext(BaseModel):
    skill: str
    reason: str
    scenario_id: Optional[int] = Field(
        default=None,
        description="A roleplay from PRACTICE OPTIONS for this skill, or null.",
    )


class SkillWordItem(BaseModel):
    skill: str
    word: SkillWord


class DebriefCards(BaseModel):
    opening: str
    important_moment: Optional[ImportantMomentCard] = None
    what_worked: List[WorkedCard] = Field(default_factory=list)
    work_on_this: List[WorkOnThisCard] = Field(default_factory=list)
    practise_next: Optional[PractiseNext] = None
    skill_words: List[SkillWordItem] = Field(default_factory=list)
    reflective_question: str = ""
    progress_note: Optional[str] = None


# --- Evaluator ------------------------------------------------------------------


class FixNote(BaseModel):
    section: str = Field(
        description=(
            "Which card: opening, important_moment, what_worked[0], work_on_this[1], "
            "practise_next, skill_words, reflective_question or progress_note."
        )
    )
    note: str = Field(description="What to change, concretely.")


class EvaluationOutput(BaseModel):
    # Risk first, as in the judge: a cue the draft leaves out is the worst failure.
    risk_cues: List[JudgeRiskCue] = Field(default_factory=list)
    dimensions: List[DimensionScore]
    hard_fails: List[HardFailFinding] = Field(default_factory=list)
    fixes: List[FixNote] = Field(default_factory=list)


# --- Reasoning out loud --------------------------------------------------------
#
# Each step also says, in a few sentences, why it decided as it did, for the
# Debrief Console's run view (v9 FR-7 "the agent's per-turn rationale", FR-38).
# The field comes last in each schema so it explains the answer rather than
# steering it. The response models in the endpoints keep their parent types, so
# pydantic serialises only the parent's fields there and the rationale travels
# in its own `reasoning` field: it never reaches the cards, the evidence map or
# anything a learner reads.

REASONING_DESCRIPTION = (
    "For the Ally team, never shown to the learner: two to four plain sentences "
    "on what you weighed and why you decided as you did. Refer to moments by "
    "turn number rather than copying long quotes."
)


class EvidenceMapReasoned(EvidenceMap):
    reasoning: str = Field(default="", description=REASONING_DESCRIPTION)


class ProgressReadingReasoned(ProgressReading):
    reasoning: str = Field(default="", description=REASONING_DESCRIPTION)


class DebriefCardsReasoned(DebriefCards):
    reasoning: str = Field(default="", description=REASONING_DESCRIPTION)


class EvaluationOutputReasoned(EvaluationOutput):
    reasoning: str = Field(default="", description=REASONING_DESCRIPTION)


def reasoning_of(output: object) -> str:
    """The step's rationale, or '' for an output without one."""
    value = getattr(output, "reasoning", "")
    return value.strip()[:2000] if isinstance(value, str) else ""
