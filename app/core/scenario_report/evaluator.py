"""
LLM-as-a-judge evaluation for scenario report transcripts.

After the simulated conversation completes, this module sends the full
transcript along with scenario context to an LLM and asks it to score
the client agent's performance across six metrics (0-100 each):
gradual_disclosure, difficulty_level, colloquialism, context_appropriateness,
consistency, and resistance.
"""

from typing import Any, Dict, List

from pydantic import BaseModel, Field, model_validator

from app.core.logger import get_logger
from app.core.scenario.base import PromptData
from app.core.scenario_report.schemas import TranscriptEntry
from app.llms import create_llm_client
from app.prompts.resolver import load_template

logger = get_logger(__name__)

_SCORE_FIELDS = (
    "gradual_disclosure",
    "difficulty_level",
    "colloquialism",
    "context_appropriateness",
    "consistency",
    "resistance",
)


# ------------------------------------------------------------------
# Structured output model
# ------------------------------------------------------------------


class EvaluationResult(BaseModel):
    """Structured response from the LLM judge."""

    gradual_disclosure: int = Field(
        ...,
        description=(
            "The extent to which the actor gradually opened up instead of "
            "opening up a lot all of a sudden towards the beginning (0-100)"
        ),
    )
    difficulty_level: int = Field(
        ...,
        description=(
            "The extent to which the actor made the roleplay practice session "
            "challenging for the helper (0-100)"
        ),
    )
    colloquialism: int = Field(
        ...,
        description=(
            "The extent to which the dialogues used by the actor were "
            "colloquial (0-100)"
        ),
    )
    context_appropriateness: int = Field(
        ...,
        description=(
            "The extent to which the dialogues used by the actor were "
            "appropriate representation of the actor's background (demographics, "
            "social background, cultural background, work background, "
            "socioeconomic background etc.) (0-100)"
        ),
    )
    consistency: int = Field(
        ...,
        description=(
            "The extent to which the actor displayed consistency in their "
            "personality (0-100)"
        ),
    )
    resistance: int = Field(
        ...,
        description=(
            "The extent to which the actor resisted the helper's attempts to "
            "help the actor (0-100)"
        ),
    )

    @model_validator(mode="after")
    def clamp_scores(self) -> "EvaluationResult":
        """Clamp all metric scores to the 0-100 range."""
        self.gradual_disclosure = max(0, min(100, self.gradual_disclosure))
        self.difficulty_level = max(0, min(100, self.difficulty_level))
        self.colloquialism = max(0, min(100, self.colloquialism))
        self.context_appropriateness = max(0, min(100, self.context_appropriateness))
        self.consistency = max(0, min(100, self.consistency))
        self.resistance = max(0, min(100, self.resistance))
        return self


# ------------------------------------------------------------------
# Prompt construction
# ------------------------------------------------------------------


def _build_evaluation_prompt(
    transcripts: List[TranscriptEntry],
    prompt_data: PromptData,
    counselor_prompt: str,
) -> str:
    """Build the user message for the evaluation LLM call."""

    # Character description from scenario
    character_parts = []
    if prompt_data.name:
        character_parts.append(f"Name: {prompt_data.name}")
    if prompt_data.age:
        character_parts.append(f"Age: {prompt_data.age}")
    if prompt_data.gender:
        character_parts.append(f"Gender: {prompt_data.gender}")
    if prompt_data.profession:
        character_parts.append(f"Profession: {prompt_data.profession}")
    if prompt_data.current_location:
        character_parts.append(f"Location: {prompt_data.current_location}")
    if prompt_data.context:
        character_parts.append(f"Context: {prompt_data.context}")
    if prompt_data.personality:
        character_parts.append(f"Personality: {prompt_data.personality}")
    if prompt_data.tone:
        character_parts.append(f"Tone: {prompt_data.tone}")
    if prompt_data.emotional_needs:
        character_parts.append(f"Emotional needs: {prompt_data.emotional_needs}")
    if prompt_data.starting_state:
        character_parts.append(f"Starting state: {prompt_data.starting_state}")
    if prompt_data.session_behavior_guidelines:
        character_parts.append(
            f"Behavior guidelines: {prompt_data.session_behavior_guidelines}"
        )

    # Include custom fields
    if prompt_data.custom_fields:
        for field in prompt_data.custom_fields:
            if isinstance(field, dict) and field.get("name") and field.get("value"):
                character_parts.append(f"{field['name']}: {field['value']}")

    character_description = (
        "\n".join(character_parts) or "No character details provided."
    )

    # Format transcript
    transcript_lines = []
    for entry in transcripts:
        transcript_lines.append(f"[{entry.role}]: {entry.content}")
    transcript_text = "\n\n".join(transcript_lines) or "No transcript available."

    return (
        f"## CLIENT Character Description\n"
        f"{character_description}\n\n"
        f"## COUNSELOR Role\n"
        f"{counselor_prompt}\n\n"
        f"## Conversation Transcript\n"
        f"{transcript_text}\n\n"
        f"Evaluate the CLIENT agent's performance."
    )


async def evaluate_transcript(
    transcripts: List[TranscriptEntry],
    prompt_data: PromptData,
    counselor_prompt: str,
) -> Dict[str, Any]:
    """
    Use an LLM as a judge to evaluate the client agent's performance.

    Args:
        transcripts: Full conversation transcript entries.
        prompt_data: Scenario character description.
        counselor_prompt: The counselor agent's system prompt.

    Returns:
        Dict with six metric scores (int 0-100 each).
        Falls back to zero scores on any error.
    """
    if not transcripts:
        logger.warning("No transcripts to evaluate")
        return {field: 0 for field in _SCORE_FIELDS}

    try:
        llm = create_llm_client().llm_instance.with_structured_output(EvaluationResult)
        user_message = _build_evaluation_prompt(
            transcripts, prompt_data, counselor_prompt
        )

        result: EvaluationResult = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": load_template("evaluation/evaluator_system"),
                },
                {"role": "user", "content": user_message},
            ]
        )

        return {field: getattr(result, field) for field in _SCORE_FIELDS}

    except Exception:
        logger.exception("LLM evaluation failed")
        return {field: 0 for field in _SCORE_FIELDS}
