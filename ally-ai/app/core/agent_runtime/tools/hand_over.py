"""`hand_over` (chunk 3b): pass the chat to a person on the team.

ally-be marks the conversation Needs a person (reason `assistant`), keeps the
summary for the team and tells the inbox; the run then ends, and ally-be replies
with its hand-over message. Off for every bot unless a platform admin turns it on.
"""

from __future__ import annotations

from pydantic import BaseModel, field_validator

from app.core.agent_runtime.tools.gateway import gateway_tool

#: ally-be refuses a longer summary, so it is clipped here rather than limited in
#: the schema: a schema limit would fail an over-long step's validation, and the
#: failed model call would end the run.
MAX_SUMMARY_CHARS = 300


class HandOverInput(BaseModel):
    # No description: the tool's own description says what to write.
    summary: str = ""

    @field_validator("summary")
    @classmethod
    def _one_line(cls, value: str) -> str:
        return " ".join((value or "").split())[:MAX_SUMMARY_CHARS]


DESCRIPTION = (
    "Pass this chat to a person on the team. Use it when someone asks to talk to a "
    "person, when you can't help with what they need and the team can, or when "
    "they're unhappy with your answers. Never for someone at risk: that is handled "
    "before you. Write one line for the team about what they need."
)

TOOL = gateway_tool(
    "hand_over",
    DESCRIPTION,
    HandOverInput,
    risk="medium",
    ends_run=True,
)
