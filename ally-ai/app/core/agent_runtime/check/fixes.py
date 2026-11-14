"""Phase 3 of the check: wording fixes, applied in order to a draft that passed
grounding.
"""

from __future__ import annotations

import re
from typing import Callable, Tuple

from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.check.text import (
    SENTENCE_END,
    contact_details,
    mentions_sources,
    normalise_detail,
    repeated_crisis_wording,
    unsupported_details,
    without_details,
    without_record_ids,
    without_repeated_crisis_wording,
    without_sentences,
    without_source_phrases,
)
from app.core.agent_runtime.check.verdict import CheckContext, Verdict
from app.core.agent_runtime.schemas import AgentIntent
from app.utils.logger import get_logger

# Logged under the package name, as when this was one module.
logger = get_logger(__package__)


# ------------------------------------------------------------------ 3. wording fixes


def _drop_unsourced_details(verdict: Verdict, ctx: CheckContext) -> None:
    """Any reply type: a phone number, link or email must be in a passage offered
    this run, or in the owner's own "when it doesn't know" wording, word for word.
    Sent back, and the sentences carrying one removed."""
    sources = [*ctx.passages, {"text": ctx.decline_text}]
    unsourced = unsupported_details(verdict.answer, sources)
    if unsourced and verdict.rejection in (None, Rejection.UNSOURCED_DETAIL):
        logger.info("Reply carries %d unsourced contact detail(s)", len(unsourced))
        verdict.rejection, verdict.keeps_text = Rejection.UNSOURCED_DETAIL, True
        verdict.answer = without_details(verdict.answer, unsourced)


_CLAUSE_END = re.compile(r"(?<=[.!?।])\s+|\s+[—–]\s+|;\s+")


def fallback_contact(decline_text: str) -> str:
    """The part of the owner's decline wording that carries its contact details
    ("please call +91 20 0000 4400."), capitalised as a sentence of its own."""
    clauses = [c.strip() for c in _CLAUSE_END.split(decline_text or "") if c.strip()]
    with_contact = [c for c in clauses if contact_details(c)]
    if not with_contact:
        return ""
    text = " ".join(with_contact)
    text = text[0].upper() + text[1:]
    return text if text[-1] in ".!?।" else f"{text}."


def add_fallback_contact(verdict: Verdict, ctx: CheckContext) -> None:
    """A decline in the agent's own words always gives the owner's fallback contact
    (chunk 20a-2): taken word for word from the bot's decline wording, never
    searched for or made up. Added only when the reply carries none of it. A
    decline with no text left gets the owner's wording from ally-be anyway."""
    if verdict.intent != AgentIntent.DECLINE or not verdict.answer.strip():
        return
    if not verdict.model_declined:
        return
    contact = fallback_contact(ctx.decline_text)
    if not contact:
        return
    wanted = {normalise_detail(d) for d in contact_details(contact)}
    present = {normalise_detail(d) for d in contact_details(verdict.answer)}
    if wanted & present:
        return
    verdict.answer = f"{verdict.answer.rstrip()} {contact}"


# The assistant offering to book, reserve or schedule for the person, which it can't
# do (chunk 20a-2; booking is "coming soon"). Telling them how to book stays.
_OFFERS_BOOKING = re.compile(
    r"\b(?:would you like|do you want|shall|should|want)\s+(?:me|us)\s+to\s+"
    r"(?:help\s+(?:you\s+)?)?(?:\w+\s+and\s+)?(?:book|reserve|schedule|arrange)\b"
    r"|\b(?:i|we)\s+(?:can|will|could)\s+(?:also\s+)?(?:help\s+(?:you\s+)?)?"
    r"(?:find\s+and\s+)?(?:book|reserve|schedule)\b"
    r"|\b(?:book|reserve|schedule)\s+(?:it|one|that|a\s+\w+)\s+for\s+you\b",
    re.IGNORECASE,
)


def offers_booking(sentence: str) -> bool:
    return bool(_OFFERS_BOOKING.search(sentence or ""))


def _trim_booking_offers(verdict: Verdict, ctx: CheckContext) -> None:
    """The assistant can't book, so it never offers to (chunk 20a-2). The sentence
    is trimmed, not sent back; if nothing would be left, the reply stays. An
    assistant with a create tool can book (chunk 6): nothing is trimmed."""
    if ctx.can_book:
        return
    if offers_booking(verdict.answer):
        verdict.answer = (
            without_sentences(verdict.answer, lambda s: not offers_booking(s))
            or verdict.answer
        )


# A day or time presented as an opening ("the 5:00 PM slot", "book you for tomorrow
# at 5", "3 pm is free", "you're booked"). Opening hours ("we're open until 8 pm",
# "online sessions are available from 7 am") aren't: they say when the place is
# open, not that a time is free (chunk 20a-2, Bring in customers).
_TIME = r"\d{1,2}(?:[:.]\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)"
_DAY = (
    r"(?:today|tomorrow|tonight|this\s+(?:morning|afternoon|evening|week)|"
    r"(?:next\s+)?(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday))"
)
_WHEN = rf"(?:{_TIME}|{_DAY})"
_OFFERS_SLOT = re.compile(
    rf"\bslots?\b[^.?!\n]{{0,25}}{_WHEN}|{_WHEN}[^.?!\n]{{0,15}}\bslots?\b"
    rf"|\b(?:book|booked|booking|reserve|reserved|schedule|scheduled)\s+"
    rf"(?:(?:you|it|that|this|them|one)\s+)?(?:in\s+)?(?:for|at|on)\s+{_WHEN}"
    rf"|\bappointments?\s+(?:for|at|on)\s+{_WHEN}"
    rf"|{_WHEN}\s+(?:is|are|looks|should\s+be)\s+(?:available|free)\b"
    rf"|\b(?:available|free)\s+(?:at|on)\s+{_WHEN}"
    r"|\b(?:you(?:'|’)re|you\s+are|you(?:'|’)ve\s+been|i(?:'|’)ve|i\s+have)\s+"
    r"(?:booked|reserved)\b",
    re.IGNORECASE,
)

#: What a Bring in customers reply says instead, if a rewrite can't be had.
TEAM_WILL_CONFIRM = "The team will confirm what's free."


def offers_slot(sentence: str) -> bool:
    return bool(_OFFERS_SLOT.search(sentence or ""))


def _send_back_slot_offers(verdict: Verdict, ctx: CheckContext) -> None:
    """A Bring in customers assistant can't see or hold appointments, so it never
    presents a time as free, as a slot or as booked (chunk 20a-2). Sent back once to
    be rewritten; the sentence is taken out meanwhile, so a reply with no time left
    for a rewrite goes out without it (and says the team will confirm). An
    assistant with a create tool can (chunk 6): `_send_back_unfound_slots` instead."""
    if ctx.can_book:
        return
    if ctx.purpose != "enquiries" or not offers_slot(verdict.answer):
        return
    kept = without_sentences(verdict.answer, lambda s: not offers_slot(s))
    verdict.answer = f"{kept} {TEAM_WILL_CONFIRM}".strip()
    if verdict.rejection is None:
        verdict.rejection, verdict.keeps_text = Rejection.OFFERS_SLOT, True


def _drop_record_ids(verdict: Verdict, ctx: CheckContext) -> None:
    """A record's id is for the tools, never the person (chunk 6): the model copies
    it from a passage's `id:` line, so it's taken out, with its label, and so is talk
    of records and citation numbers. Only in a run with record passages, so every
    other reply is exactly as before. Trimmed, not sent back."""
    if not any(passage.get("record_id") for passage in ctx.passages):
        return
    verdict.answer = without_record_ids(verdict.answer) or verdict.answer


def _send_back_unfound_slots(verdict: Verdict, ctx: CheckContext) -> None:
    """An assistant that can book (chunk 6) may name a time as free or booked only
    from its lists: the reply must cite a record a list tool returned. Otherwise
    the sentence is taken out and the draft sent back once, to look it up first."""
    if not ctx.can_book or not offers_slot(verdict.answer):
        return
    if any(citation.get("record_id") for citation in verdict.citations):
        return
    verdict.answer = without_sentences(verdict.answer, lambda s: not offers_slot(s))
    if verdict.rejection is None:
        verdict.rejection, verdict.keeps_text = Rejection.UNFOUND_SLOT, True


def _trim_repeated_crisis_wording(verdict: Verdict, ctx: CheckContext) -> None:
    """Trimmed, not sent back: a rewrite costs a model call for what a deterministic
    trim does. If trimming would leave nothing, the reply stays as is."""
    if repeated_crisis_wording(verdict.answer, ctx.turn_type, ctx.history):
        verdict.answer = (
            without_repeated_crisis_wording(verdict.answer, ctx.turn_type)
            or verdict.answer
        )


def _trim_repeated_topic_list(verdict: Verdict, ctx: CheckContext) -> None:
    """The topics were offered once; later small talk doesn't list them again.
    Trimmed, not sent back (as above)."""
    earlier = any(turn.get("role") == "assistant" for turn in ctx.history)
    if not (earlier and ctx.turn_type == "smalltalk"):
        return
    listed = [
        sentence
        for sentence in SENTENCE_END.split(verdict.answer)
        if ctx.organisation.topics_named_in(sentence) >= 3
    ]
    if listed:
        verdict.answer = (
            without_sentences(verdict.answer, lambda sentence: sentence not in listed)
            or verdict.answer
        )


def _cut_source_phrases(verdict: Verdict, ctx: CheckContext) -> None:
    verdict.answer = without_source_phrases(verdict.answer) or verdict.answer


def _flag_source_talk(verdict: Verdict, ctx: CheckContext) -> None:
    """Wording, not safety: kept as written if the rewrite still does it."""
    if verdict.rejection is None and mentions_sources(verdict.answer):
        verdict.rejection, verdict.keeps_text = Rejection.MENTIONS_SOURCES, True


def _decline_if_nothing_left(verdict: Verdict, ctx: CheckContext) -> None:
    """Nothing left once the unsourced details were removed."""
    if verdict.keeps_text and not verdict.answer:
        verdict.intent, verdict.keeps_text = AgentIntent.DECLINE, False


#: Applied in this order to every reply that isn't a decline the check forced.
WORDING_FIXES: Tuple[Callable[[Verdict, CheckContext], None], ...] = (
    _drop_record_ids,
    _drop_unsourced_details,
    _trim_repeated_crisis_wording,
    _trim_repeated_topic_list,
    _trim_booking_offers,
    _send_back_slot_offers,
    _send_back_unfound_slots,
    _cut_source_phrases,
    _flag_source_talk,
    _decline_if_nothing_left,
)
