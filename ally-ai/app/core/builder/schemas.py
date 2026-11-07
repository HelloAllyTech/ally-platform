"""Structured outputs for the builder's model calls, one per sub-task.

The 3a rules apply: flat shapes, defaults rather than Optional, an Enum rather than
a one-value Literal. Nothing here can name a draft path: the conversation step
proposes values for a fixed set of fields, and code turns them into patches, so the
model cannot even express a change to the safety pack, the documents or the access
list.
"""

from __future__ import annotations

from enum import Enum
from typing import List

from pydantic import BaseModel, Field

from app.schemas.builder import DesignId, Industry, LearnedSection, PrechatFieldType


class Tone(str, Enum):
    UNCHANGED = "unchanged"
    WARM = "warm"
    PROFESSIONAL = "professional"
    FRIENDLY = "friendly"
    FORMAL = "formal"


class DesignChoice(str, Enum):
    NONE = "none"
    GUIDE = "guide"
    ENQUIRIES = "enquiries"
    SUPPORT = "support"


# --- extract -----------------------------------------------------------------


class FactOut(BaseModel):
    section: LearnedSection = LearnedSection.ABOUT
    text: str = ""
    # The page number it came from, as numbered in the prompt. A number, not a URL:
    # an out-of-range number is easy to catch, a made-up URL is not.
    page: int = 0


class ExtractOut(BaseModel):
    facts: List[FactOut] = Field(default_factory=list)


# --- classify ----------------------------------------------------------------


class ClassifyOut(BaseModel):
    industry: Industry = Industry.OTHER
    confidence: float = 0.0


# --- gaps --------------------------------------------------------------------


class ExtraGap(BaseModel):
    item: str = ""
    why: str = ""


class GapsOut(BaseModel):
    # Checklist keys the business's information does not answer.
    missing: List[str] = Field(default_factory=list)
    # Up to two things the site itself leaves open, beyond the checklist.
    extra: List[ExtraGap] = Field(default_factory=list)


# --- designs -----------------------------------------------------------------


class DesignOut(BaseModel):
    id: DesignId = DesignId.GUIDE
    title: str = ""
    best_for: str = ""
    visitor_line: str = ""
    assistant_line: str = ""


class DesignsOut(BaseModel):
    designs: List[DesignOut] = Field(default_factory=list)


# --- draft -------------------------------------------------------------------


class PrechatOut(BaseModel):
    label: str = ""
    type: PrechatFieldType = PrechatFieldType.TEXT
    required: bool = False
    options: List[str] = Field(default_factory=list)


class DraftOut(BaseModel):
    assistant_name: str = ""
    introduction: str = ""
    instructions: str = ""
    tone: Tone = Tone.WARM
    topics: List[str] = Field(default_factory=list)
    suggested_questions: List[str] = Field(default_factory=list)
    prechat: List[PrechatOut] = Field(default_factory=list)
    decline_text: str = ""


# --- the conversation step ---------------------------------------------------


class OwnerFact(BaseModel):
    section: LearnedSection = LearnedSection.ABOUT
    text: str = ""


class ConverseOut(BaseModel):
    message: str = ""
    chips: List[str] = Field(default_factory=list)
    # True when the owner is happy to move on from this step.
    step_done: bool = False
    # The owner's answer to the question asked last, in their words, tidied; "" if
    # this message doesn't answer it.
    answer: str = ""
    # Proposed changes. Empty or "unchanged" means no change.
    name: str = ""
    assistant_name: str = ""
    tone: Tone = Tone.UNCHANGED
    languages: List[str] = Field(default_factory=list)
    decline_text: str = ""
    design: DesignChoice = DesignChoice.NONE
    # Details the owner told you in this message, to add to "What we learned".
    owner_facts: List[OwnerFact] = Field(default_factory=list)
