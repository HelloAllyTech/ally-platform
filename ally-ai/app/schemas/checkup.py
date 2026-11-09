"""The checkup grader's contract (chunk 20a-2).

One grader serves the Checkup, the eval suites and (from Q2a) the scorecard, so a
number means the same thing wherever it's shown. ally-be runs each question through
its real engine and sends the case plus what happened; this service only judges.
"""

from __future__ import annotations

from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class CheckupExpect(str, Enum):
    ANSWER = "answer"
    DECLINE = "decline"
    CLARIFY = "clarify"
    CRISIS_ONLY = "crisis_only"
    SMALLTALK = "smalltalk"


class CheckupOutcome(str, Enum):
    """What the assistant actually did, read from the engine's own label."""

    ANSWERED = "answered"
    DECLINED = "declined"
    CLARIFIED = "clarified"
    CRISIS = "crisis"
    SMALLTALK = "smalltalk"
    OTHER = "other"


class CheckupVerdict(str, Enum):
    PASS = "pass"
    FAIL = "fail"
    #: Declined honestly because the information doesn't cover it yet: a gap for the
    #: owner to fill, not a mistake.
    NEEDS_INPUT = "needs_input"


class CheckupSource(BaseModel):
    """Where the expected answer lives. `gap` means the information doesn't cover it."""

    kind: str = Field("", description="page, document, owner, pack, platform or gap")
    url: str = ""
    document_id: str = ""
    title: str = ""


class CheckupCase(BaseModel):
    id: str
    question: str
    expect: CheckupExpect
    facts: List[str] = Field(default_factory=list)
    must_not: List[str] = Field(default_factory=list)
    also_ok: List[str] = Field(default_factory=list)
    hard_fail: bool = False
    source: CheckupSource = Field(default_factory=CheckupSource)


class CheckupCitation(BaseModel):
    chunk_id: str = ""
    document_id: str = ""
    document_title: str = ""
    source_url: str = ""


class CheckupObserved(BaseModel):
    """One run of the case through ally-be's engine (the Preview path)."""

    reply: str = ""
    handled_by: str = Field(
        "", description="ally-be's label: rag, declined, clarified, crisis, template…"
    )
    turn_type: str = ""
    citations: List[CheckupCitation] = Field(default_factory=list)
    passage_document_ids: List[str] = Field(default_factory=list)
    would_file_unanswered: bool = False
    history: List[Dict[str, Any]] = Field(
        default_factory=list, description="Earlier turns of the case's thread, if any."
    )


class GradeRequest(BaseModel):
    case: CheckupCase
    observed: CheckupObserved
    judge: bool = Field(True, description="False runs the automatic checks only.")
    prompts: Optional[Dict[str, Any]] = None


class JudgeFindings(BaseModel):
    facts_missing: List[str] = Field(default_factory=list)
    must_not_found: List[str] = Field(default_factory=list)
    also_ok_matched: bool = False
    answers_question: bool = True
    invents_facts: bool = False
    declines_request: bool = False
    note: str = ""


class GradeResponse(BaseModel):
    verdict: CheckupVerdict
    outcome: CheckupOutcome
    reasons: List[str] = Field(default_factory=list)
    hard_fail: bool = False
    #: An answer case declined. True when the page holding the answer was among
    #: the passages (the agent had it and still declined); null when unknown.
    wrong_decline: bool = False
    answer_page_offered: Optional[bool] = None
    cited_expected_source: Optional[bool] = None
    judge: Optional[JudgeFindings] = None
    grader_version: str
