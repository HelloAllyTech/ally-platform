"""
LLM-as-a-judge evaluation for scenario report transcripts.

After the simulated conversation completes, this module sends the full
transcript along with scenario context to an LLM and asks it to score
the client agent's performance. Metrics are fully prompt-driven — adding
or removing a metric from the system prompt requires no code changes here.
"""

from typing import Any, Dict, List, Optional

from langchain_openai import ChatOpenAI
from pydantic import BaseModel, Field, model_validator

from app.core.config import settings
from app.core.llm_usage.emitter import emit_langchain_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger
from app.core.scenario.base import PromptData
from app.core.scenario_report.schemas import TranscriptEntry
from app.prompts.resolver import load_template, resolve_template

logger = get_logger(__name__)

# Evaluator-specific LLM tuning. Different from the default LLM client
# returned by app.llms.create_llm_client() in three ways:
#   - timeout=120s (default is 30s) — the judge consumes the entire
#     transcript (can be 100KB+ for 100-turn reports) plus a sizeable
#     rubric prompt, and must emit structured JSON containing both
#     metrics and a multi-paragraph markdown report. OpenAI's gpt-4o-mini
#     consistently needs 30-60s on long inputs; 30s was tripping the
#     APITimeoutError observed for 100-turn runs.
#   - temperature=0 — the judge should be deterministic across re-runs
#     so the same transcript produces the same metric scores. The default
#     temperature is tuned for the conversational agents, not for scoring.
#   - model pinned to gpt-4o-mini — explicit and version-pinned at the
#     report layer, so swapping the default conversational model in
#     settings won't silently change report scoring behaviour.
_EVALUATOR_MODEL = "gpt-4o-mini"
_EVALUATOR_TIMEOUT_S = 180
_EVALUATOR_TEMPERATURE = 0


def _build_evaluator_llm(
    model: Optional[str] = None, temperature: Optional[float] = None
):
    """Return a ChatOpenAI instance tuned for transcript evaluation.

    `model`/`temperature` come from the selected evaluator prompt's per-prompt
    config (Prompt Management) when set, else fall back to the pinned judge
    defaults. The judge runs on OpenAI (json_mode structured output), so only an
    OpenAI model override is applied here (see ``evaluate_transcript``).

    Built per-call rather than at module import so any settings change
    (e.g. test fixtures swapping the API key) takes effect without
    process restart, and so the client doesn't persist a background
    session in the report-gen worker between runs.
    """
    return ChatOpenAI(
        model=model or _EVALUATOR_MODEL,
        temperature=temperature if temperature is not None else _EVALUATOR_TEMPERATURE,
        api_key=settings.OPENAI_API_KEY,
        timeout=_EVALUATOR_TIMEOUT_S,
        max_retries=1,
    )


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
    selected_prompt_code: Optional[str] = None,
    report_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Use an LLM as a judge to evaluate the client agent's performance.

    The judge's tokens are recorded to ``llm_usage`` as
    ``scenario_report_evaluation`` under ``report_id`` as room (a rehearsal has
    no session; its graph-node calls record under the same id), with
    ``metadata.report_id``. A parse failure still records what it spent.

    Args:
        selected_prompt_code: promptCode of an evaluator (transcript-judge)
            variant to run. When set, the evaluator system prompt is resolved
            from that variant's (dashboard-overridden) text, falling back to the
            default evaluator template when the code can't be resolved. When
            None, the default template is used. Resolved WITHOUT formatting
            (resolve_template, not load_and_format_by_code) because the evaluator
            prompt contains literal braces (JSON scoring examples) that must not
            be treated as format placeholders.

    Returns:
        Dict with a 'metrics' key (Dict[str, int]) and a 'report_markdown' key (str).
        Falls back to empty metrics and empty markdown on any error.
    """
    if not transcripts:
        logger.warning("No transcripts to evaluate")
        return {"metrics": {}, "report_markdown": ""}

    try:
        # Honor the selected evaluator prompt's per-prompt model/temperature
        # (set in Prompt Management). The judge uses OpenAI json_mode structured
        # output, so a non-OpenAI model override is ignored (default judge model
        # kept); the temperature override still applies.
        eval_model: Optional[str] = None
        eval_temperature: Optional[float] = None
        if selected_prompt_code:
            from app.core.agent.factory import get_prompt_llm_overrides
            from app.llms.factory import infer_provider_from_model

            provider, model, temperature = get_prompt_llm_overrides(
                prompt_data, selected_prompt_code
            )
            eval_temperature = temperature
            resolved_provider = provider or (
                infer_provider_from_model(model) if model else None
            )
            if model and resolved_provider == "openai":
                eval_model = model
            elif model:
                logger.info(
                    "Evaluator prompt %s requests non-OpenAI model %r; the judge "
                    "runs on OpenAI, keeping the default model (temperature "
                    "override still applies).",
                    selected_prompt_code,
                    model,
                )

        base_llm = _build_evaluator_llm(eval_model, eval_temperature)
        # include_raw because the parsed model alone carries no usage metadata.
        llm = base_llm.with_structured_output(
            EvaluationResult, method="json_mode", include_raw=True
        )
        user_message = _build_evaluation_prompt(
            transcripts, prompt_data, counselor_prompt
        )

        evaluator_system_prompt = ""
        if selected_prompt_code:
            evaluator_system_prompt = resolve_template(
                selected_prompt_code, prompt_data
            )
        if not evaluator_system_prompt:
            evaluator_system_prompt = load_template(
                "evaluation/evaluator_system", prompt_data
            )

        raw_result = await llm.ainvoke(
            [
                {
                    "role": "system",
                    "content": evaluator_system_prompt,
                },
                {"role": "user", "content": user_message},
            ]
        )
        if isinstance(raw_result, dict):
            # Emitted before parsing: a parse failure still spent the tokens.
            emit_langchain_usage(
                raw_result.get("raw"),
                task=LLMTask.SCENARIO_REPORT_EVALUATION.value,
                provider="openai",
                model=getattr(base_llm, "model_name", None),
                room_id=report_id,
                metadata={"report_id": report_id} if report_id else None,
            )
            result: EvaluationResult = raw_result.get("parsed")
            if result is None:
                # include_raw captures a parse failure instead of raising it;
                # raise it so the except below returns the empty result, as a
                # parse failure did before.
                raise ValueError(
                    "report judge returned unparseable output: "
                    f"{raw_result.get('parsing_error')}"
                )
        else:
            # Defensive: some providers/wrappers may ignore include_raw.
            result = raw_result

        return {"metrics": result.metrics, "report_markdown": result.report_markdown}

    except Exception:
        logger.exception("LLM evaluation failed")
        return {"metrics": {}, "report_markdown": ""}
