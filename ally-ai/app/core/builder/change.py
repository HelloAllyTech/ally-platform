"""Change by chat (chunk 20a-2): an owner's request as a proposed change.

The model proposes values for a fixed set of fields; code turns them into before and
after, drops anything unchanged, keeps own rules and topics to avoid add-only, and
never lets a change reach the safety pack. ally-be applies a proposal only when the
owner confirms it, through the same field saves as the assistant home.
"""

from __future__ import annotations

import re
from enum import Enum
from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field

from app.core.builder.tasks import ungrounded
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format

PROMPT = "builder/change"


class ChangeTone(str, Enum):
    UNCHANGED = ""
    WARM = "warm"
    BALANCED = "balanced"
    FORMAL = "formal"


class ChangeLanguage(str, Enum):
    UNCHANGED = ""
    EN = "en"
    HI = "hi"
    AUTO = "auto"


class CurrentAssistant(BaseModel):
    assistant_name: str = ""
    introduction: str = ""
    tone: str = ""
    instructions: str = ""
    decline_text: str = ""
    suggested_questions: List[str] = Field(default_factory=list)
    language: str = "en"
    own_rules: List[str] = Field(default_factory=list)
    avoid_topics: List[str] = Field(default_factory=list)


class ChangeRequest(BaseModel):
    request: str = Field(..., max_length=1000)
    current: CurrentAssistant
    safety_rules: List[str] = Field(default_factory=list)
    prompts: Optional[Dict[str, Any]] = None


class ChangeOut(BaseModel):
    """What the model writes."""

    reply: str = ""
    refused: bool = False
    assistant_name: str = ""
    introduction: str = ""
    tone: ChangeTone = ChangeTone.UNCHANGED
    instructions: str = ""
    decline_text: str = ""
    suggested_questions: List[str] = Field(default_factory=list)
    language: ChangeLanguage = ChangeLanguage.UNCHANGED
    new_rules: List[str] = Field(default_factory=list)
    avoid_topics: List[str] = Field(default_factory=list)


class FieldChange(BaseModel):
    field: str
    before: Any
    after: Any


class ChangeResponse(BaseModel):
    reply: str
    refused: bool = False
    changes: List[FieldChange] = Field(default_factory=list)


# Asking to turn safety off is refused in code too, whatever the model says.
_WEAKENS_SAFETY = re.compile(
    r"\b(?:turn|switch|shut)\s+off|\bdisable|\bremove|\bstop|\bdelete|\bwithout"
    r"|\bno\s+more|\bignore|\bskip|\bdrop|\bbypass",
    re.IGNORECASE,
)
_SAFETY_WORDS = re.compile(
    r"crisis|safety|safe\b|disclaimer|consent|helpline|emergency|tele-?manas|rules?",
    re.IGNORECASE,
)


def weakens_safety(request: str) -> bool:
    return bool(_WEAKENS_SAFETY.search(request) and _SAFETY_WORDS.search(request))


def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split())[:limit]


def build_changes(request: ChangeRequest, out: ChangeOut) -> ChangeResponse:
    if out.refused or weakens_safety(request.request):
        return ChangeResponse(reply="", refused=True)
    now = request.current
    source = " ".join(
        [now.instructions, now.introduction, now.decline_text, request.request]
    )
    changes: List[FieldChange] = []

    def propose(field: str, before: Any, after: Any) -> None:
        if after in ("", None, []) or after == before:
            return
        changes.append(FieldChange(field=field, before=before, after=after))

    for field, limit in (
        ("assistant_name", 60),
        ("introduction", 600),
        ("decline_text", 500),
    ):
        after = _clean(getattr(out, field), limit)
        # No new numbers: facts come from the pages, never from settings.
        if after and not ungrounded(after, source):
            propose(field, getattr(now, field), after)
    instructions = (out.instructions or "").strip()[:4000]
    if instructions and not ungrounded(instructions, source):
        propose("instructions", now.instructions, instructions)
    propose("tone", now.tone, out.tone.value)
    propose("language", now.language, out.language.value)
    questions = [_clean(q, 120) for q in out.suggested_questions if q.strip()][:4]
    if questions and not any(ungrounded(q, source) for q in questions):
        propose("suggested_questions", now.suggested_questions, questions)
    known_rules = {r.lower() for r in now.own_rules}
    for rule in out.new_rules[:3]:
        rule = _clean(rule, 200)
        if rule and rule.lower() not in known_rules:
            known_rules.add(rule.lower())
            changes.append(FieldChange(field="add_rule", before=None, after=rule))
    known_topics = {t.lower() for t in now.avoid_topics}
    for topic in out.avoid_topics[:5]:
        topic = _clean(topic, 80)
        if topic and topic.lower() not in known_topics:
            known_topics.add(topic.lower())
            changes.append(FieldChange(field="avoid_topic", before=None, after=topic))
    return ChangeResponse(reply=_clean(out.reply, 400), changes=changes)


def _format_current(now: CurrentAssistant) -> str:
    rows = [
        f"assistant_name: {now.assistant_name}",
        f"introduction: {now.introduction}",
        f"tone: {now.tone}",
        f"language: {now.language}",
        f"decline_text: {now.decline_text}",
        "suggested_questions: " + "; ".join(now.suggested_questions),
        "own rules (never): " + "; ".join(now.own_rules),
        "topics to avoid: " + "; ".join(now.avoid_topics),
        f"instructions:\n{now.instructions}",
    ]
    return "\n".join(rows)


async def propose_change(request: ChangeRequest) -> ChangeResponse:
    if weakens_safety(request.request):
        return ChangeResponse(reply="", refused=True)
    prompt = load_and_format(
        PROMPT,
        prompts=request.prompts,
        current=_format_current(request.current),
        safety="\n".join(f"- {r}" for r in request.safety_rules) or "(none)",
        request=request.request,
    )
    if not prompt:
        raise LLMInvocationFailedException(f"The prompt {PROMPT} is missing or empty.")
    provider, model, temperature = get_backend_llm_overrides(PROMPT, request.prompts)
    out, _meta = await generate_structured(
        schema=ChangeOut,
        prompt=prompt,
        task=LLMTask.ONBOARDING_CHANGE.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        max_tokens=None,
    )
    return build_changes(request, out)
