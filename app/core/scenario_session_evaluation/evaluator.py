"""
LLM-as-a-judge evaluation of the roleplay ACTOR agent for a REAL session,
scored against the superadmin-configured agent test cases.

Unlike the scenario-report evaluator (whose 6 metrics are fixed in a prompt
template), the goals here are dynamic — supplied per request by ally-be — so
the system prompt is built in code with the goal list injected. The LLM tuning
(model / temperature / timeout) and the structured-output model are reused from
the report evaluator so the two judges behave identically.
"""

from typing import Any, Dict, List

from app.core.logger import get_logger
from app.core.scenario_report.evaluator import (
    EvaluationResult,
    _build_evaluator_llm,
)
from app.core.scenario_session_evaluation.schemas import (
    ActorEvaluationGoal,
    ActorEvaluationTurn,
)

logger = get_logger(__name__)


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
        "Respond ONLY as JSON with two keys:\n"
        '- "metrics": an object mapping each goal\'s EXACT title (verbatim, as '
        "given above) to its integer 0-100 score. Include every goal.\n"
        '- "report_markdown": a markdown report for a training supervisor — a '
        "short overall summary, then one section per goal with its score and "
        "1-3 sentences of reasoning citing the transcript, then overall "
        "strengths and areas for improvement."
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
) -> Dict[str, Any]:
    """Run the LLM judge; returns {'metrics': {...}, 'report_markdown': str}.

    Raises on LLM failure so the caller can ship a FAILED webhook (we want the
    superadmin to see *that* an evaluation failed, not a silent empty result).
    """
    if not transcript:
        return {"metrics": {}, "report_markdown": ""}
    if not goals:
        return {"metrics": {}, "report_markdown": ""}

    llm = _build_evaluator_llm().with_structured_output(
        EvaluationResult, method="json_mode"
    )
    result: EvaluationResult = await llm.ainvoke(
        [
            {"role": "system", "content": build_actor_goal_system_prompt(goals)},
            {"role": "user", "content": _build_user_message(transcript)},
        ]
    )
    return {"metrics": result.metrics, "report_markdown": result.report_markdown}
