"""The PM agent answers Builder's interview questions (plan §11.5, FR-63).

A person handed one of the PM agent's "needs code" ideas to Builder and chose the
PM agent to answer Builder's questions. ally-be sends the idea's brief (written by
the PM agent, quotes already stripped by the gateway) and Builder's pending
question; this answers it from the brief alone, or says plainly that it can't, so
ally-be leaves the question for the person who handed the idea over.

The instructions are a Skills Store prompt (`ally_ai_debrief_pm_builder_answers_system`,
not pinned): ally-be sends its live text in `prompts`; the default file is the fallback.

One structured model call, the PM agent's model with its backup as a fallback
(LangChain `with_fallbacks`). Its cost is recorded to `llm_usage` as
`debrief_improver`, so ally-be counts it against the learning budget. Quotes are
stripped from every answer before it leaves: Builder never receives learner words.
"""

from __future__ import annotations

import json
from typing import Any, Callable, Dict, List, Optional

from langchain_core.messages import HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.debrief_graph.budget import cost_usd
from app.core.llm.dispatch import infer_provider_from_model
from app.core.llm_usage.emitter import emit_llm_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.pm_agent.models import build_models
from app.core.pm_agent.quotes import strip_quotes
from app.core.pm_agent.schemas import BuilderAnswersRequest
from app.prompts.resolver import load_template
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The instructions' Skills Store prompt (`ally_ai_debrief_pm_builder_answers_system`):
#: the live text comes in the request's `prompts`; the default file is the fallback.
PROMPT_PATH = "debrief/pm_builder_answers_system"


class BuilderAnswer(BaseModel):
    question_id: str = Field(description="The id of the question you answer")
    can_answer: bool = Field(
        description="False when the brief does not settle the question"
    )
    selected_option_ids: List[str] = Field(
        default_factory=list,
        description="Ids of the options you pick; empty when none fits",
    )
    answer: str = Field(
        default="",
        description="Your answer in your own words; empty when can_answer is false",
    )
    reason: str = Field(
        default="",
        description="When can_answer is false: what the brief does not settle",
    )


class BuilderAnswers(BaseModel):
    answers: List[BuilderAnswer]


def render_request(req: BuilderAnswersRequest) -> str:
    brief = req.brief.model_dump()
    questions = [q.model_dump(exclude_none=True) for q in req.questions]
    return (
        "Your brief for Builder:\n"
        + json.dumps(brief, ensure_ascii=False, indent=2)
        + "\n\nBuilder asks:\n"
        + json.dumps(questions, ensure_ascii=False, indent=2)
        + "\n\nAnswer each question once."
    )


def _escalated(question_id: str, reason: str) -> Dict[str, Any]:
    return {
        "question_id": question_id,
        "can_answer": False,
        "selected_option_ids": [],
        "answer": "",
        "reason": reason,
    }


def _clean(
    req: BuilderAnswersRequest, parsed: Optional[BuilderAnswers]
) -> List[Dict[str, Any]]:
    """One answer per asked question, in order: unknown option ids dropped,
    quotes stripped, and an answer that is empty once stripped escalated."""
    by_id = {a.question_id: a for a in (parsed.answers if parsed else [])}
    out: List[Dict[str, Any]] = []
    for q in req.questions:
        a = by_id.get(q.id)
        if a is None:
            out.append(_escalated(q.id, "The PM agent gave no answer."))
            continue
        reason = strip_quotes(a.reason or "", req.known_texts)[0].strip()
        if not a.can_answer:
            out.append(_escalated(q.id, reason or "The brief does not settle this."))
            continue
        options = {o.id for o in q.options}
        picked = [i for i in a.selected_option_ids if i in options]
        text, removed = strip_quotes(a.answer or "", req.known_texts)
        text = text.strip()
        if removed or (not text and not picked):
            # A quote in an answer means it leaned on someone's words: a person
            # answers instead, rather than Builder getting a half-redacted line.
            out.append(
                _escalated(
                    q.id,
                    (
                        "The answer quoted someone, so it was not sent."
                        if removed
                        else "The PM agent gave no answer."
                    ),
                )
            )
            continue
        out.append(
            {
                "question_id": q.id,
                "can_answer": True,
                "selected_option_ids": picked,
                "answer": text,
                "reason": "",
            }
        )
    return out


async def answer_builder_questions(
    req: BuilderAnswersRequest,
    *,
    default_model: str,
    models_factory: Callable[..., Dict[str, Any]] = build_models,
) -> Dict[str, Any]:
    primary = req.model or default_model

    def result(status: str, answers, cost=0.0, model=None, error=None):
        return {
            "status": status,
            "answers": answers,
            "estimated_cost_usd": round(cost, 4),
            "model": model,
            "error": error,
        }

    def everything_escalated(reason: str):
        return [_escalated(q.id, reason) for q in req.questions]

    if not req.questions:
        return result("finished", [])
    if req.budget_usd <= 0:
        return result(
            "budget_spent",
            everything_escalated("The learning budget is spent."),
        )
    models = models_factory(primary, req.backup_model, req.prices)
    if not models:
        return result(
            "failed",
            everything_escalated("No model can run here."),
            error="no priced model this environment can run",
        )
    names = [n for n in (primary, req.backup_model) if n in models]
    names += [n for n in models if n not in names]
    runnables = [
        models[n].with_structured_output(BuilderAnswers, include_raw=True)
        for n in names
    ]
    chain = (
        runnables[0].with_fallbacks(runnables[1:])
        if len(runnables) > 1
        else runnables[0]
    )
    messages = [
        SystemMessage(content=load_template(PROMPT_PATH, prompts=req.prompts)),
        HumanMessage(render_request(req)),
    ]
    try:
        out = await chain.ainvoke(messages)
    except Exception as e:  # noqa: BLE001 - reported to ally-be; a person answers
        logger.error("Builder answers for %s failed: %s", req.idea_id, type(e).__name__)
        return result(
            "failed",
            everything_escalated("The PM agent could not answer just now."),
            error=f"{type(e).__name__}: {e}"[:300],
        )
    raw = out.get("raw") if isinstance(out, dict) else None
    meta = getattr(raw, "response_metadata", None) or {}
    used = meta.get("model_name") or meta.get("model") or names[0]
    used = next((n for n in names if str(used).endswith(n)), names[0])
    usage = getattr(raw, "usage_metadata", None) or {}
    prompt = int(usage.get("input_tokens") or 0)
    completion = int(usage.get("output_tokens") or 0)
    cost = cost_usd(used, prompt, completion, req.prices)
    emit_llm_usage(
        infer_provider_from_model(used),
        used,
        LLMTask.DEBRIEF_PM_AGENT.value,
        (prompt, completion, int(usage.get("total_tokens") or 0)),
        metadata={"ideaId": req.idea_id, "agent": "builder_answers"},
    )
    parsed = out.get("parsed") if isinstance(out, dict) else None
    if not isinstance(parsed, BuilderAnswers):
        return result(
            "finished",
            everything_escalated("The PM agent's answer could not be read."),
            cost,
            used,
        )
    return result("finished", _clean(req, parsed), cost, used)
