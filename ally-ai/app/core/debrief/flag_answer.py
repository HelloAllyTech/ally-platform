"""The Debrief agent answers a learner's flag (V2_AUTONOMY F1).

A learner flagged one card of their debrief as not right. ally-be sends the
roleplay transcript, the flagged card, the learner's reason and note, and the
debrief's language; this re-reads them and decides:

- `keep`: the card stays; the reply says why;
- `correct`: some of the card's own fields are rewritten (never its quote), and
  every span the rewrite puts in quotation marks must appear in the transcript;
- `remove`: the card goes. Never for the important moment (a risk card): that one
  is only kept or corrected.

One structured model call (`with_structured_output`, the backup model via
`with_fallbacks`). An answer that breaks a rule above is sent back once with the
problem named; a second bad answer is `failed`, and ally-be leaves the flag for its
sweep. Cost is recorded to `llm_usage` as `debrief_flag_answer`. ally-be applies the
decision (card versions kept) and tells the learner.
"""

from __future__ import annotations

import json
import re
from typing import Any, Callable, Dict, List, Literal, Optional

from langchain_core.messages import AIMessage, HumanMessage, SystemMessage
from pydantic import BaseModel, Field

from app.core.debrief_graph.budget import cost_usd
from app.core.llm.dispatch import infer_provider_from_model
from app.core.llm_usage.emitter import emit_llm_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.pm_agent.models import build_models
from app.prompts.resolver import load_template
from app.utils.logger import get_logger

logger = get_logger(__name__)

PROMPT_PATH = "debrief/flag_answer_system"
#: The fields of a card that may be rewritten (ally-be's CORRECTABLE_FIELDS).
CORRECTABLE_FIELDS = ("lead", "body", "why", "try_saying", "reason")
#: Two tries at most: the second is told what was wrong with the first.
MAX_TRIES = 2
_QUOTED = re.compile(r"[\"“”]([^\"“”]{3,})[\"“”]")
#: The reply's cap, the prompt's "at most three short sentences" (2026-11-16):
#: the wording is the prompt's, the check is here.
REPLY_MAX_SENTENCES = 3
#: A sentence ends at . ! ? or the Devanagari danda, before a space or the end;
#: a decimal point or "e.g." mid-word does not end one.
_SENTENCE_END = re.compile(r"[.!?।]+(?=\s|$)")


def sentence_count(text: str) -> int:
    """Sentences in a reply: ends counted, plus a last one without a full stop."""
    t = text.strip()
    if not t:
        return 0
    ends = len(_SENTENCE_END.findall(t))
    return ends + (0 if _SENTENCE_END.search(t[-1:] + " ") else 1)


class CardRewrite(BaseModel):
    lead: Optional[str] = None
    body: Optional[str] = None
    why: Optional[str] = None
    try_saying: Optional[str] = None
    reason: Optional[str] = None


class FlagDecision(BaseModel):
    action: Literal["keep", "correct", "remove"]
    correction: Optional[CardRewrite] = Field(
        None,
        description="For correct only: the rewritten fields; leave the rest out.",
    )
    reply: str = Field(
        description="To the learner, in the debrief's language: what you decided "
        "and why."
    )


class TranscriptLine(BaseModel):
    turn_index: int
    role: str
    text: str


class FlagAnswerRequest(BaseModel):
    flag_id: str
    run_id: str
    language: str = "en"
    section: str
    reason: Optional[str] = None
    note: Optional[str] = None
    card: Dict[str, Any]
    transcript: List[TranscriptLine]
    model: str
    backup_model: Optional[str] = None
    prices: Dict[str, Dict[str, float]] = Field(default_factory=dict)
    budget_usd: float = Field(0.05, ge=0)
    prompts: Optional[Dict[str, Any]] = None


class FlagAnswerResponse(BaseModel):
    status: Literal["finished", "budget_spent", "failed"]
    action: Optional[Literal["keep", "correct", "remove"]] = None
    correction: Optional[Dict[str, str]] = None
    reply: Optional[str] = None
    estimated_cost_usd: float = 0.0
    model: Optional[str] = None
    error: Optional[str] = None


def is_important_moment(section: str) -> bool:
    return section == "important_moment" or section.startswith("important_moment.")


def _norm(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip().lower()


def problem_with(decision: FlagDecision, req: FlagAnswerRequest) -> Optional[str]:
    """What breaks the rules in this answer, in words the model can act on."""
    if not decision.reply.strip():
        return "The reply to the learner is empty."
    n = sentence_count(decision.reply)
    if n > REPLY_MAX_SENTENCES:
        return (
            f"The reply to the learner has {n} sentences; write at most "
            f"{REPLY_MAX_SENTENCES} short ones."
        )
    if decision.action == "remove" and is_important_moment(req.section):
        return "The important-moment card is never removed: keep it or correct it."
    if decision.action != "correct":
        return None
    fields = {
        k: v.strip()
        for k, v in (
            decision.correction.model_dump() if decision.correction else {}
        ).items()
        if isinstance(v, str) and v.strip() and k in req.card
    }
    if not fields:
        return "A correction must rewrite at least one of the card's own fields."
    transcript = _norm(" ".join(t.text for t in req.transcript))
    for value in fields.values():
        for span in _QUOTED.findall(value):
            if _norm(span) not in transcript:
                return (
                    f"The words in quotation marks ({span[:60]}) are not in the "
                    "transcript. Quote the transcript exactly or do not quote."
                )
    return None


def render_request(req: FlagAnswerRequest) -> str:
    transcript = "\n".join(
        f"[{t.turn_index}] {'Learner' if t.role == 'counselor' else 'Character'}: {t.text}"
        for t in req.transcript
    )
    card = {k: v for k, v in req.card.items() if k != "point_id"}
    return (
        f"Debrief language: {req.language}\n"
        f"Flagged card ({req.section}):\n"
        + json.dumps(card, ensure_ascii=False, indent=2)
        + f"\n\nThe learner's reason: {req.reason or 'not given'}"
        + f"\nThe learner's note: {req.note or 'none'}"
        + (
            "\nThis is the important-moment card: keep or correct, never remove."
            if is_important_moment(req.section)
            else ""
        )
        + f"\n\nRoleplay transcript:\n{transcript}"
    )


async def answer_flag(
    req: FlagAnswerRequest,
    *,
    models_factory: Callable[..., Dict[str, Any]] = build_models,
) -> Dict[str, Any]:
    spent = 0.0
    used: Optional[str] = None

    def result(status: str, decision: Optional[FlagDecision] = None, error=None):
        correction = None
        if decision and decision.action == "correct" and decision.correction:
            correction = {
                k: v.strip()
                for k, v in decision.correction.model_dump().items()
                if isinstance(v, str) and v.strip() and k in req.card
            }
        return {
            "status": status,
            "action": decision.action if decision else None,
            "correction": correction,
            "reply": decision.reply.strip() if decision else None,
            "estimated_cost_usd": round(spent, 4),
            "model": used,
            "error": error,
        }

    if req.budget_usd <= 0:
        return result("budget_spent")
    models = models_factory(req.model, req.backup_model, req.prices)
    if not models:
        return result("failed", error="no priced model this environment can run")
    names = [n for n in (req.model, req.backup_model) if n in models]
    names += [n for n in models if n not in names]
    runnables = [
        models[n].with_structured_output(FlagDecision, include_raw=True) for n in names
    ]
    chain = (
        runnables[0].with_fallbacks(runnables[1:])
        if len(runnables) > 1
        else runnables[0]
    )
    messages: List[Any] = [
        SystemMessage(content=load_template(PROMPT_PATH, prompts=req.prompts)),
        HumanMessage(render_request(req)),
    ]
    problem: Optional[str] = None
    for _ in range(MAX_TRIES):
        if spent >= req.budget_usd:
            return result("budget_spent", error=problem)
        try:
            out = await chain.ainvoke(messages)
        except Exception as e:  # noqa: BLE001 - ally-be's sweep tries again later
            logger.error("Flag answer %s failed: %s", req.flag_id, type(e).__name__)
            return result("failed", error=f"{type(e).__name__}: {e}"[:300])
        raw = out.get("raw") if isinstance(out, dict) else None
        meta = getattr(raw, "response_metadata", None) or {}
        name = meta.get("model_name") or meta.get("model") or names[0]
        used = next((n for n in names if str(name).endswith(n)), names[0])
        usage = getattr(raw, "usage_metadata", None) or {}
        prompt = int(usage.get("input_tokens") or 0)
        completion = int(usage.get("output_tokens") or 0)
        spent += cost_usd(used, prompt, completion, req.prices)
        emit_llm_usage(
            infer_provider_from_model(used),
            used,
            LLMTask.DEBRIEF_FLAG_ANSWER.value,
            (prompt, completion, int(usage.get("total_tokens") or 0)),
            metadata={"runId": req.run_id, "flagId": req.flag_id},
        )
        decision = out.get("parsed") if isinstance(out, dict) else None
        if not isinstance(decision, FlagDecision):
            problem = "The answer could not be read; answer in the given shape."
        else:
            problem = problem_with(decision, req)
            if problem is None:
                return result("finished", decision)
        messages = [
            *messages,
            AIMessage(content=getattr(raw, "content", "") or ""),
            HumanMessage(
                content=f"That answer cannot be used: {problem} Answer again."
            ),
        ]
    return result("failed", error=problem)
