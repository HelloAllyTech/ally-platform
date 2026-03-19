"""Schemas for guardrail event detection."""

from pydantic import BaseModel


class GuardrailData(BaseModel):
    """
    Data payload for a single guardrail.

    helper_dialogue : what the counselor says to TRIGGER the guardrail
    actor_dialogue  : what the AI agent should be guided to say back
    """

    helper_dialogue: str
    actor_dialogue: str

    class Config:
        frozen = True
