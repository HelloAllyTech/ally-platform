"""`hand_over` (chunk 3b): pass the chat to a person on the team.

ally-be marks the conversation Needs a person (reason `assistant`), keeps the
summary for the team and tells the inbox. The run then goes on (Q4 G1: a
hand-over never replaces an answer): the reply answers what it can, and ally-be
adds its hand-over line, in the person's language, after it.
"""

from __future__ import annotations

from pydantic import BaseModel, Field, field_validator

from app.core.agent_runtime.tools.gateway import gateway_tool

#: The summary is one short sentence for the team (chunk 6b): clipped here rather
#: than limited in the schema, since a schema limit would fail an over-long step's
#: validation, and the failed model call would end the run. ally-be allows up to 300.
MAX_SUMMARY_CHARS = 160

#: What the model is told to write (model-facing, chunk 6b).
SUMMARY_DESCRIPTION = (
    "One sentence, at most 160 characters, saying what the person needs, in plain "
    "words. Don't say which channel the chat is on: the team sees it."
)


class HandOverInput(BaseModel):
    summary: str = Field("", description=SUMMARY_DESCRIPTION)

    @field_validator("summary")
    @classmethod
    def _one_line(cls, value: str) -> str:
        text = " ".join((value or "").split())
        if len(text) <= MAX_SUMMARY_CHARS:
            return text
        # Cut at the last word that fits, never mid-word (unless it's one word).
        cut = text[: MAX_SUMMARY_CHARS + 1]
        return (
            cut.rsplit(" ", 1)[0] if " " in cut else cut[:MAX_SUMMARY_CHARS]
        ).rstrip(",;:")


DESCRIPTION = (
    "Pass this chat to a person on the team. Use it when someone asks to talk to a "
    "person, when you can't help with what they need and the team can, or when "
    "they're unhappy with your answers. Never for someone at risk: that is handled "
    "before you."
)

TOOL = gateway_tool(
    "hand_over",
    DESCRIPTION,
    HandOverInput,
    risk="medium",
)
