"""
LLM-as-a-judge evaluation for scenario report transcripts.

After the simulated conversation completes, this module sends the full
transcript along with scenario context to an LLM and asks it to score
the client agent's performance. Metrics are fully prompt-driven — adding
or removing a metric from the system prompt requires no code changes here.
"""

from typing import Any, Dict, List

from pydantic import BaseModel, Field, model_validator

from app.core.logger import get_logger
from app.core.scenario.base import PromptData
from app.core.scenario_report.schemas import TranscriptEntry
from app.llms import create_llm_client
from app.prompts.resolver import load_template

logger = get_logger(__name__)


# ------------------------------------------------------------------
# Structured output model
# ------------------------------------------------------------------


class EvaluationResult(BaseModel):
    """Structured response from the LLM judge."""

    metrics: Dict[str, int] = Field(
        ...,
        description=(
            "Dictionary of metric name to score (0-100). "
            "Keys are snake_case metric names as defined in the system prompt."
        ),
    )
    report_markdown: str = Field(
        default="",
        description=(
            "A full markdown evaluation report for a training supervisor. "
            "Must include a summary, metric scores, per-metric analysis "
            "with reasoning, strengths, and areas for improvement."
        ),
    )

    @model_validator(mode="after")
    def clamp_scores(self) -> "EvaluationResult":
        self.metrics = {k: max(0, min(100, v)) for k, v in self.metrics.items()}
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

    if prompt_data.custom_fields:
        for field in prompt_data.custom_fields:
            if isinstance(field, dict) and field.get("name") and field.get("value"):
                character_parts.append(f"{field['name']}: {field['value']}")

    character_description = (
        "\n".join(character_parts) or "No character details provided."
    )

    transcript_lines = [f"[{e.role}]: {e.content}" for e in transcripts]
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

    Returns:
        Dict with a 'metrics' key (Dict[str, int]) and a 'report_markdown' key (str).
        Falls back to empty metrics and empty markdown on any error.
    """
    if not transcripts:
        logger.warning("No transcripts to evaluate")
        return {"metrics": {}, "report_markdown": ""}

    try:
        llm = create_llm_client().llm_instance.with_structured_output(
            EvaluationResult, method="json_mode"
        )
        user_message = _build_evaluation_prompt(
            transcripts, prompt_data, counselor_prompt
        )

        result: EvaluationResult = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": load_template(
                        "evaluation/evaluator_system", prompt_data
                    ),
                },
                {"role": "user", "content": user_message},
            ]
        )

        return {"metrics": result.metrics, "report_markdown": result.report_markdown}

    except Exception:
        logger.exception("LLM evaluation failed")
        return {"metrics": {}, "report_markdown": ""}
