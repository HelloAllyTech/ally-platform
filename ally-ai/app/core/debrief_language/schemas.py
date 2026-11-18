"""Schemas for the debrief language judge.

Asks one narrow question of a debrief's own text: **is it written well in the
session's language?** Not whether the coaching is good (the debrief-quality
judge asks that), and not whether the roleplay's AI client spoke well (the
language-quality judge asks that, about the client's turns only).

The judge returns findings only: where, which closed error type, the exact words
that show it, and a short note. There is no score. Every rate is computed in
ally-be, so a threshold can move without re-judging, the same division of labour
as the other judges.
"""

from __future__ import annotations

from typing import List, Literal, Tuple, get_args

from pydantic import BaseModel, Field

# One question per type. The rubric defines each one and what it is NOT.
ErrorType = Literal[
    "wrong_language",
    "script_mix",
    "untranslated_chunk",
    "quote_altered",
    "stiff_register",
    "literal_translation",
    "grammar_or_agreement",
    "meaning_drift",
]
ERROR_TYPES: Tuple[str, ...] = get_args(ErrorType)

#: A debrief with more findings than this is a debrief the judge cannot be
#: trusted on; the extras are dropped and counted.
MAX_FINDINGS = 12
#: Evidence longer than this is a paragraph, not a quote.
MAX_EVIDENCE_CHARS = 280
MAX_NOTE_CHARS = 240


class RawFinding(BaseModel):
    """One finding as the judge LLM returns it.

    The type is a free string on purpose: a type the judge invents is dropped in
    code (and counted), never trusted and never allowed to fail the whole call.
    """

    section: str = Field(
        description="The section name from the DEBRIEF block the words are in."
    )
    error_type: str = Field(description="One of the closed ERROR TYPES.")
    evidence_quote: str = Field(
        description="The exact words from the debrief that show the problem."
    )
    note: str = Field(description="One short sentence saying what is wrong.")


class DebriefLanguageOutput(BaseModel):
    """Exactly what the judge LLM returns."""

    findings: List[RawFinding] = Field(default_factory=list)


class LanguageFinding(BaseModel):
    """A finding that passed validation: a known type, quoting real words."""

    section: str
    error_type: ErrorType
    evidence_quote: str
    note: str


class JudgedDebriefLanguage(BaseModel):
    """What the endpoint and the gate read."""

    findings: List[LanguageFinding] = Field(default_factory=list)
    # Findings discarded in code, by reason; shown in the Agent logs, never hidden.
    dropped: dict = Field(default_factory=dict)
