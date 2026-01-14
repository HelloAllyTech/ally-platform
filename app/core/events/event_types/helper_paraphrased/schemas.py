"""Schemas for helper paraphrased event detection."""

from pydantic import BaseModel


class ParaphraseResult(BaseModel):
    """
    Structured output schema for paraphrase evaluation.

    The LLM returns a boolean indicating whether the counselor
    paraphrased the agent's message.
    """

    is_paraphrase: bool

    class Config:
        json_schema_extra = {
            "example": {
                "is_paraphrase": True,
            }
        }
