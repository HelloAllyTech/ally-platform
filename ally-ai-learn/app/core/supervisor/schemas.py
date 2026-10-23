"""Structured output for the live-supervisor LLM."""

from __future__ import annotations

from pydantic import BaseModel, Field


class SupervisorNoteVerdict(BaseModel):
    """One turn's decision from the live supervisor.

    Two fields rather than a bare optional string: making the "say nothing"
    case an explicit boolean gives the model somewhere to land when the answer
    is silence. Asked for a note directly, an LLM will almost always produce
    one — which is the failure mode this feature has to avoid, since the
    learner is mid-conversation and reads every note that appears.
    """

    should_note: bool = Field(
        description="True only when the learner needs a note now; false on most turns."
    )
    note: str = Field(
        default="",
        description=(
            "The coaching hint, one sentence, in the session language. Empty "
            "when should_note is false."
        ),
    )
