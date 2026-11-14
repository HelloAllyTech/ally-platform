"""Rules the check enforces in code: the safety pack's, and the owner's topics to
avoid.
"""

from __future__ import annotations

import re

from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.check.text import without_sentences
from app.core.agent_runtime.check.verdict import CheckContext, Verdict
from app.core.agent_runtime.schemas import AgentIntent
from app.utils.logger import get_logger

# Logged under the package name, as when this was one module.
logger = get_logger(__package__)


# ------------------------------------------------------------- safety packs (20a)

#: Packs whose rules the check enforces in code as well as in the prompt.
HEALTH_PACKS = frozenset({"mental_health", "medical", "pharmacy"})

_CONDITIONS = (
    r"(?:an?\s+)?(?:depression|anxiety|panic(?: disorder| attacks?)?|bipolar|ocd|"
    r"ptsd|adhd|schizophrenia|psychosis|an? eating disorder|insomnia|diabetes|"
    r"hypertension|high blood pressure|an? infection|a heart attack|a stroke|"
    r"a disorder|"
    r"a condition|burnout|a personality disorder)"
)
_MEDICINES = (
    r"(?:medication|medicines?|tablets?|pills?|capsules?|doses?|dosage|"
    r"antidepressants?|painkillers?|insulin|[a-z]+(?:pine|pam|zole|pril|olol|statin|"
    r"xetine|traline|lam|done|profen|mol|cillin))"
)
#: Diagnosis, reading a result, dosing, or changing a medicine: never from a pack bot.
_CLINICAL = [
    re.compile(p, re.IGNORECASE)
    for p in (
        rf"\b(?:you|they)\s+(?:may\s+|might\s+|probably\s+|likely\s+|could\s+)?"
        rf"(?:have|has|are suffering from|suffer from|are experiencing)\s+"
        rf"{_CONDITIONS}",
        rf"\b(?:it|this|that|these|you)\s+(?:sounds?|looks?|seems?)\s+like\s+"
        rf"(?:you have\s+)?{_CONDITIONS}",
        r"\byou(?:'re| are)\s+(?:probably\s+|likely\s+)?(?:depressed|bipolar|"
        r"diabetic|hypertensive|anxious disorder)\b",
        r"\b(?:hba1c|cholesterol|blood sugar|sugar level|tsh|ha?emoglobin|creatinine|"
        r"blood pressure reading|report)\b(?:[^.?!]|\.\d){0,40}"
        r"\b(?:is|are|looks?|seems?)\s+"
        r"(?:a bit\s+|slightly\s+|very\s+)?(?:high|low|normal|fine|bad|good|"
        r"elevated|concerning|nothing to worry)",
        r"\b(?:take|taking|have|give|use)\s+(?:up to\s+|no more than\s+)?"
        r"(?:\d+(?:\.\d+)?|one|two|three|four|half|a)\s*(?:mg|mcg|ml|units?|"
        r"tablets?|pills?|capsules?|doses?|teaspoons?|drops?)\b",
        r"\b(?:\d+|one|two|three|four)\s+(?:tablets?|pills?|capsules?|doses?)\s+"
        r"(?:a|per|every|each|twice|thrice|once|daily|at)\b",
        r"\b\d+(?:\.\d+)?\s?(?:mg|mcg)\b",
        rf"\b(?:stop|start|increase|decrease|reduce|double|skip|halve|switch)\s+"
        rf"(?:taking\s+)?(?:your\s+|the\s+)?{_MEDICINES}\b",
        r"\b(?:you can|you could|you should|it'?s (?:safe|fine|ok(?:ay)?) to)\s+"
        r"(?:safely\s+)?(?:take|mix|combine|double|stop|skip)\b"
        r"(?!\s+(?:your|a|the|some)\s+(?:time|break|look|seat|moment|rest|call)\b)"
        r"(?!\s+it\s+easy\b)",
    )
]
#: A match in a sentence like "don't stop your medication without your doctor" is
#: the safe advice, not the unsafe one.
_DEFERS = re.compile(
    r"n't\b|\b(?:not|never|without|before|ask|asking|check|talk|speak|consult|"
    r"cannot|unable)\b",
    re.IGNORECASE,
)


def clinical_advice(text: str) -> bool:
    """Whether `text` diagnoses, reads a result, doses, or changes a medicine."""
    for pattern in _CLINICAL:
        for match in pattern.finditer(text or ""):
            before = text[max(0, match.start() - 30) : match.start()]
            if not _DEFERS.search(before) and not _DEFERS.search(match.group(0)):
                return True
    return False


def enforce_safety_pack(verdict: Verdict, ctx: CheckContext) -> None:
    """A health pack's Never rules, in code: whatever the instructions or the model
    say, a reply never diagnoses or doses. Sent back once; if the rewrite still
    does it, those sentences are removed, and with nothing left it declines."""
    if ctx.safety_pack not in HEALTH_PACKS or not clinical_advice(verdict.answer):
        return
    logger.info("Reply gave clinical advice on a health-pack bot; refused")
    verdict.rejection, verdict.keeps_text = Rejection.CLINICAL_ADVICE, False
    verdict.answer = without_sentences(
        verdict.answer, lambda sentence: not clinical_advice(sentence)
    )
    if not verdict.answer.strip():
        verdict.intent, verdict.citations = AgentIntent.DECLINE, []
        verdict.model_declined = False


def _stem(word: str) -> str:
    word = word.lower()
    for suffix in ("ing", "es", "s"):
        if len(word) > 4 and word.endswith(suffix):
            return word[: -len(suffix)]
    return word


def touches_topic(text: str, topic: str) -> bool:
    """Whether `text` mentions `topic`: each of the topic's words of four letters or
    more, by its stem ("prices" matches "price" and "pricing")."""
    words = [_stem(w) for w in re.findall(r"[\w']+", topic) if len(w) >= 4]
    if not words:
        return False
    stems = {_stem(w) for w in re.findall(r"[\w']+", text or "")}
    return all(any(s.startswith(w) for s in stems) for w in words)


def enforce_avoid_topics(verdict: Verdict, ctx: CheckContext) -> None:
    """The owner's topics to avoid, in code (chunk 20a-2): a reply to a question
    about one, or that brings one up, becomes the bot's decline wording. Other
    questions are untouched."""
    if verdict.intent == AgentIntent.DECLINE and not verdict.answer.strip():
        return
    hit = next(
        (
            t
            for t in ctx.avoid_topics
            if touches_topic(ctx.question, t) or touches_topic(verdict.answer, t)
        ),
        None,
    )
    if hit is None:
        return
    logger.info("Reply touched a topic the owner asked it to avoid; declining")
    verdict.intent, verdict.citations, verdict.answer = AgentIntent.DECLINE, [], ""
    verdict.model_declined, verdict.rejection = False, None
