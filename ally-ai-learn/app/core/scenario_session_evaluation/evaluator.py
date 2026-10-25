"""
LLM-as-a-judge evaluation of the roleplay ACTOR agent for a REAL session,
scored against the superadmin-configured agent test cases.

Unlike the scenario-report evaluator (whose 6 metrics are fixed in a prompt
template), the goals here are dynamic — supplied per request by ally-be — so
the system prompt is built in code with the goal list injected. The LLM tuning
(model / temperature / timeout) and the structured-output model are reused from
the report evaluator so the two judges behave identically.
"""

from typing import Any, Dict, List, Optional, Tuple

from pydantic import BaseModel, Field, model_validator

from app.core.llm_usage.emitter import emit_langchain_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger
from app.core.scenario_report.evaluator import _build_evaluator_llm
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationTurn,
)

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


def build_actor_goal_system_prompt(goals: List[ActorEvaluationGoal]) -> str:
    """System prompt instructing the judge to score the actor per goal."""
    goal_lines = []
    for g in goals:
        desc = f" — {g.description}" if g.description else ""
        goal_lines.append(f'- "{g.title}" (category: {g.category}){desc}')
    goals_block = "\n".join(goal_lines)

    return (
        "You are an expert evaluator of AI ROLEPLAY ACTOR agents used for "
        "training. A roleplay actor is an AI that plays a persona (e.g. a "
        "help-seeker) which a trainee practises a conversation with.\n\n"
        "You will be given a conversation transcript. Turns labelled "
        "[assistant] are the ROLEPLAY ACTOR you are evaluating. Turns labelled "
        "[user] are the trainee — do NOT score the trainee.\n\n"
        "Evaluate ONLY the actor's performance against each of the following "
        "superadmin-configured agent test cases. For each goal, assign an "
        "integer score from 0 to 100 for how well the actor achieved that goal "
        "across the whole conversation (0 = not at all, 100 = exemplary).\n\n"
        f"Agent test cases:\n{goals_block}\n\n"
        "Scoring guidance: 50-59 below average, 60-69 average, 70-79 good, "
        "80-89 very good, 90-100 exceptional.\n\n"
        "APPLICABILITY. These test cases are configured globally, so some may "
        "have nothing to do with this particular conversation. A goal is NOT "
        "APPLICABLE when the conversation gave the actor no occasion to "
        "demonstrate it — the situation it describes never arose. Judge this "
        "on the situation, not on the actor's performance: a goal the actor "
        "had a clear opportunity to meet and handled badly IS applicable and "
        "must be scored low. Only the absence of any opportunity makes a goal "
        "not applicable. When in doubt, treat the goal as applicable.\n\n"
        "Respond ONLY as JSON with three keys:\n"
        '- "metrics": an object mapping each goal\'s EXACT title (verbatim, as '
        "given above) to its integer 0-100 score. Include every goal, "
        "including any you mark not applicable.\n"
        '- "not_applicable": an array of the EXACT titles (verbatim) of goals '
        "the conversation gave no occasion to demonstrate. Use an empty array "
        "when every goal was genuinely exercised.\n"
        '- "report_markdown": a markdown report for a training supervisor — a '
        "short overall summary, then one section per goal with its score and "
        "1-3 sentences of reasoning citing the transcript (say explicitly when "
        "a goal was not applicable and why), then overall strengths and areas "
        "for improvement."
    )


def _build_user_message(transcript: List[ActorEvaluationTurn]) -> str:
    lines = [f"[{t.role}]: {t.content}" for t in transcript]
    transcript_text = "\n\n".join(lines) or "No transcript available."
    return (
        f"## Conversation Transcript\n{transcript_text}\n\n"
        "Evaluate the ACTOR ([assistant]) agent's performance against the "
        "agent test cases."
    )


async def evaluate_actor_goals(
    transcript: List[ActorEvaluationTurn],
    goals: List[ActorEvaluationGoal],
    scenario_session_id: Optional[str] = None,
) -> Tuple[Dict[str, Any], str]:
    """Run the LLM judge.
    Returns a tuple of (evaluation dict, raw LLM response string). The dict
    is ``{'metrics': {...}, 'not_applicable': [...], 'report_markdown': str}``.
    Raises on LLM failure so the caller can ship a FAILED webhook (we want the
    superadmin to see *that* an evaluation failed, not a silent empty result).
    The judge's tokens are emitted to ``llm_usage`` as ``actor_evaluation``,
    attributed by ``scenario_session_id``: this runs in an HTTP request after
    the session, with no LiveKit room to attribute it by.
    """
    if not transcript:
        return {"metrics": {}, "not_applicable": [], "report_markdown": ""}, ""
    if not goals:
        return {"metrics": {}, "not_applicable": [], "report_markdown": ""}, ""

    base_llm = _build_evaluator_llm()
    # include_raw because the parsed model alone carries no usage metadata.
    llm = base_llm.with_structured_output(
        ActorGoalEvaluationResult, method="json_mode", include_raw=True
    )
    raw_result = await llm.ainvoke(
        [
            {"role": "system", "content": build_actor_goal_system_prompt(goals)},
            {"role": "user", "content": _build_user_message(transcript)},
        ]
    )
    raw_content = ""
    if isinstance(raw_result, dict):
        raw_message = raw_result.get("raw")
        if raw_message and hasattr(raw_message, "content"):
            raw_content = str(raw_message.content)

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
    }, raw_content
