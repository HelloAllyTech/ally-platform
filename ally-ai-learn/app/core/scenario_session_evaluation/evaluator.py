"""
LLM-as-a-judge evaluation of the roleplay ACTOR agent for a REAL session,
scored against the superadmin-configured agent test cases.

Unlike the scenario-report evaluator (whose 6 metrics are fixed in a prompt
template), the goals here are dynamic — supplied per request by ally-be — so
the goal list is built in code and passed to the Skills Store prompt
(``evaluation/actor_goal_system``) as ``goals_block``. The LLM tuning
(model / temperature / timeout) and the structured-output model are reused from
the report evaluator so the two judges behave identically.
"""

from types import SimpleNamespace
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field, model_validator

from app.core.llm_usage.emitter import emit_langchain_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger
from app.core.scenario_report.evaluator import _build_evaluator_llm
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationTurn,
)
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)


class ActorGoalEvaluationResult(BaseModel):
    """Structured response from the actor-goal judge.

    Deliberately NOT the scenario-report judge's ``EvaluationResult``: the two
    share LLM tuning, but this one carries ``not_applicable``, and the field
    descriptions of a structured-output model are shown to the model. Adding a
    goal-applicability field to the shared model would put it in front of the
    report judge, which has no such concept.
    """

    metrics: Dict[str, int] = Field(
        ...,
        description=(
            "Dictionary of goal title (verbatim) to score (0-100). "
            "Include EVERY goal, including ones listed in not_applicable."
        ),
    )
    not_applicable: List[str] = Field(
        default_factory=list,
        description=(
            "Titles of goals the conversation gave no occasion to demonstrate. "
            "Empty when every goal was genuinely exercised."
        ),
    )
    report_markdown: str = Field(
        default="",
        description=(
            "A full markdown evaluation report for a training supervisor. "
            "Must include a summary, per-goal analysis with reasoning, "
            "strengths, and areas for improvement."
        ),
    )

    @model_validator(mode="after")
    def clamp_scores(self) -> "ActorGoalEvaluationResult":
        self.metrics = {k: max(0, min(100, v)) for k, v in self.metrics.items()}
        return self


#: The judge's system prompt, in the Skills Store. Its live text comes in the
#: request's ``prompts`` map (ally-be sends it); the local default is the
#: fallback for a request without it.
ACTOR_GOAL_SYSTEM_PROMPT = "evaluation/actor_goal_system"
ACTOR_GOAL_SYSTEM_PROMPT_CODE = "ally_ai_learn_evaluation_actor_goal_system"


def _build_goals_block(goals: List[ActorEvaluationGoal]) -> str:
    goal_lines = []
    for g in goals:
        desc = f" — {g.description}" if g.description else ""
        goal_lines.append(f'- "{g.title}" (category: {g.category}){desc}')
    return "\n".join(goal_lines)


def build_actor_goal_system_prompt(
    goals: List[ActorEvaluationGoal],
    prompts: Optional[Dict[str, Any]] = None,
) -> str:
    """System prompt instructing the judge to score the actor per goal.

    ``prompts`` is the request's Skills Store map (``{code: {prompt, ...}}``).
    Stripped like the store's text, so the local default's trailing newline
    never reaches the model.
    """
    return load_and_format(
        ACTOR_GOAL_SYSTEM_PROMPT,
        prompt_data=prompts,
        goals_block=_build_goals_block(goals),
    ).strip()


def _build_user_message(transcript: List[ActorEvaluationTurn]) -> str:
    lines = [f"[{t.role}]: {t.content}" for t in transcript]
    transcript_text = "\n\n".join(lines) or "No transcript available."
    return (
        f"## Conversation Transcript\n{transcript_text}\n\n"
        "Evaluate the ACTOR ([assistant]) agent's performance against the "
        "agent test cases."
    )


def _judge_llm_overrides(
    prompts: Optional[Dict[str, Any]],
) -> tuple[Optional[str], Optional[float]]:
    """(model, temperature) the Skills Store set on the judge's prompt.

    As in the report judge: it runs on OpenAI json_mode structured output, so
    only an OpenAI model is applied; the temperature applies either way.
    """
    from app.core.agent.factory import get_prompt_llm_overrides
    from app.llms.factory import infer_provider_from_model

    provider, model, temperature = get_prompt_llm_overrides(
        SimpleNamespace(prompts=prompts or {}), ACTOR_GOAL_SYSTEM_PROMPT_CODE
    )
    resolved_provider = provider or (
        infer_provider_from_model(model) if model else None
    )
    if model and resolved_provider != "openai":
        logger.info(
            "Actor judge prompt requests non-OpenAI model %r; the judge runs on "
            "OpenAI, keeping the default model (temperature override still "
            "applies).",
            model,
        )
        model = None
    return model, temperature


async def evaluate_actor_goals(
    transcript: List[ActorEvaluationTurn],
    goals: List[ActorEvaluationGoal],
    scenario_session_id: Optional[str] = None,
    prompts: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Run the LLM judge.

    Returns {'metrics': {...}, 'not_applicable': [...], 'report_markdown': str}.

    Raises on LLM failure so the caller can ship a FAILED webhook (we want the
    superadmin to see *that* an evaluation failed, not a silent empty result).

    The judge's tokens are emitted to ``llm_usage`` as ``actor_evaluation``,
    attributed by ``scenario_session_id``: this runs in an HTTP request after
    the session, with no LiveKit room to attribute it by.

    ``prompts`` is the request's Skills Store map: the judge's system prompt
    and any model/temperature set on it come from there.
    """
    if not transcript:
        return {"metrics": {}, "not_applicable": [], "report_markdown": ""}
    if not goals:
        return {"metrics": {}, "not_applicable": [], "report_markdown": ""}

    base_llm = _build_evaluator_llm(*_judge_llm_overrides(prompts))
    # include_raw because the parsed model alone carries no usage metadata.
    llm = base_llm.with_structured_output(
        ActorGoalEvaluationResult, method="json_mode", include_raw=True
    )
    raw_result = await llm.ainvoke(
        [
            {
                "role": "system",
                "content": build_actor_goal_system_prompt(goals, prompts),
            },
            {"role": "user", "content": _build_user_message(transcript)},
        ]
    )
    if isinstance(raw_result, dict):
        # Emitted before parsing: a parse failure still spent the tokens.
        emit_langchain_usage(
            raw_result.get("raw"),
            task=LLMTask.ACTOR_EVALUATION.value,
            provider="openai",
            model=getattr(base_llm, "model_name", None),
            scenario_session_id=scenario_session_id,
        )
        result: ActorGoalEvaluationResult = raw_result.get("parsed")
        if result is None:
            # include_raw captures a parse failure instead of raising it; raise
            # it anyway, so the caller still ships a FAILED webhook.
            raise ValueError(
                "actor judge returned unparseable output: "
                f"{raw_result.get('parsing_error')}"
            )
    else:
        # Defensive: some providers/wrappers may ignore include_raw.
        result = raw_result

    # Only echo back titles that actually match a configured goal. The judge
    # keys applicability by verbatim title, so a paraphrase or typo would
    # otherwise silently drop a goal from the composite. Unmatched titles fail
    # toward "applicable", i.e. the pre-existing behaviour.
    goal_titles = {g.title for g in goals}
    not_applicable = [t for t in result.not_applicable if t in goal_titles]
    dropped = [t for t in result.not_applicable if t not in goal_titles]
    if dropped:
        logger.warning(
            "Actor judge returned %d not_applicable title(s) matching no "
            "configured goal; treating them as applicable: %s",
            len(dropped),
            dropped,
        )

    return {
        "metrics": result.metrics,
        "not_applicable": not_applicable,
        "report_markdown": result.report_markdown,
    }
