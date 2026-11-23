"""Phase 3 of the check: wording fixes, applied in order to a draft that passed
grounding.
"""

from __future__ import annotations

import re
from typing import Callable, Tuple

from app.core.agent_runtime.check.offered_times import ground_offered_times
from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.check.text import (
    SENTENCE_END,
    contact_details,
    in_a_persons_words,
    looks_factual,
    mentions_sources,
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
from app.core.knowledge_agent.agent import resolve_citations
from app.utils.logger import get_logger

# Logged under the package name, as when this was one module.
logger = get_logger(__package__)


# ------------------------------------------------------------------ 3. wording fixes


def _looked(ctx: CheckContext) -> bool:
    """Whether the run looked anything up: a search or a list find (or it has
    passages, which only a look-up adds)."""
    return ctx.searched or ctx.looked_up or bool(ctx.found)


def _keep_out_of_scope_declines_generic(verdict: Verdict, ctx: CheckContext) -> None:
    """A decline written without looking anything up (a poem, the weather) may say
    in general terms what the assistant helps with, but carries no specific fact:
    no phone number, price, time, link or email (chunk 6b, SP1's evals). Nothing
    was looked up, so nothing in it can be cited. The sentences carrying one are
    trimmed, not sent back; if nothing is left, the owner's wording goes out."""
    if verdict.intent != AgentIntent.DECLINE or not verdict.model_declined:
        return
    if _looked(ctx) or not verdict.answer.strip():
        return
    if looks_factual(verdict.answer):
        logger.info("Out-of-scope decline carries specific details; trimming them")
        verdict.answer = without_sentences(
            verdict.answer, lambda sentence: not looks_factual(sentence)
        )
    if asks_for_contact(ctx.question) and not contact_details(verdict.answer):
        contact = decline_contact(ctx)
        if contact:
            verdict.answer = f"{verdict.answer} {contact}".strip()


_ASKS_FOR_CONTACT = re.compile(
    r"\b(?:phone|mobile|number|contact|e-?mail|whats\s?app|call|reach)\b", re.I
)


def asks_for_contact(question: str) -> bool:
    """The person asked how to reach someone ("Dr. Kavya's personal mobile?"): a
    decline then points them to the owner's own contact, word for word (chunk 6b)."""
    return bool(_ASKS_FOR_CONTACT.search(question or ""))


def _drop_unsourced_details(verdict: Verdict, ctx: CheckContext) -> None:
    """Any reply type: a phone number, link or email must be in a passage offered
    this run, or in the owner's own "when it doesn't know" wording, word for word.
    Sent back, and the sentences carrying one removed. The owner's wording counts
    only once the run looked something up, or when the person asked how to reach
    someone (chunk 6b): an out-of-scope decline doesn't hand out contact details."""
    sources = [*ctx.passages]
    if _looked(ctx) or asks_for_contact(ctx.question):
        sources.append({"text": ctx.decline_text})
        # The business's contact from its sources (Q3-fast Part 2) is sourced too.
        sources.append({"text": ctx.business_contact})
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


def decline_contact(ctx: CheckContext) -> str:
    """How a decline points the person on (Q3-fast Part 2, 17 Nov S10/S11/C8c): the
    owner's decline wording's own contact, word for word; else the business's
    contact from its sources ("You can reach us on +91 22 6849 3328 or
    connect@…"). Never one that is in neither."""
    own = fallback_contact(ctx.decline_text)
    if own:
        return own
    found = ctx.business_contact.strip()
    return f"You can reach us on {found}." if found else ""


def add_fallback_contact(verdict: Verdict, ctx: CheckContext) -> None:
    """A decline in the agent's own words always gives the owner's fallback contact
    (chunk 20a-2): taken word for word from the bot's decline wording, never
    searched for or made up. Added only when the reply carries none of it. A
    decline with no text left gets the owner's wording from ally-be anyway."""
    if verdict.intent != AgentIntent.DECLINE or not verdict.answer.strip():
        return
    if not verdict.model_declined:
        return
    if not _looked(ctx):
        # Out of scope (a poem, the weather): nothing was looked up, and the reply
        # stays generic, with no contact to call (chunk 6b).
        return
    contact = decline_contact(ctx)
    if not contact:
        return
    # Once only (Q3-fast, gaps item 7: "Please call 95949 04015." after a reply that
    # had already given numbers): a reply that gives any phone or email is left as is.
    if contact_details(verdict.answer):
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


# Offers of actions no assistant can take (Q3-fast Part 2, 17 Nov C3): there is no
# cart, no delivery estimate and no shipping notification, and "explain our guarantee
# policies" implied there are guarantees to explain (P5).
_FALSE_OFFERS = re.compile(
    r"\badd\s+(?:it|this|that|them|these|those|one|the\s+\w+)?\s*to\s+(?:your|the)\s+"
    r"(?:cart|bag|basket)\b"
    r"|\b(?:check|get|give\s+you|look\s+up|share)\s+(?:a|an|the|your)?\s*"
    r"(?:delivery|shipping)\s+(?:estimate|date|time)\b"
    r"|\b(?:send|give)\s+you\s+(?:shipping|delivery|order)\s+updates\b"
    r"|\bshipping\s+updates\b"
    r"|\bexplain\s+(?:our|the|its|their)?\s*guarantee\s+polic",
    re.IGNORECASE,
)


def _trim_false_offers(verdict: Verdict, ctx: CheckContext) -> None:
    """An offer no tool makes possible is trimmed, not sent back (Q3-fast Part 2):
    "I can add it to your cart", "I can check a delivery estimate". If nothing would
    be left, the reply stays."""
    if _FALSE_OFFERS.search(verdict.answer):
        verdict.answer = (
            without_sentences(verdict.answer, lambda s: not _FALSE_OFFERS.search(s))
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


# Saying a time isn't free offers nothing (chunk 6b): "Nothing's free on Thursday
# evening", "no slots on Friday", "Thursday is fully booked".
_NOT_FREE = re.compile(
    r"\b(?:nothing|none|no(?:\s+\w+){0,2}\s+(?:slots?|times?|appointments?|"
    r"openings?)|not|isn['’]?t|aren['’]?t|fully\s+booked|booked\s+up)\b",
    re.IGNORECASE,
)


def offers_slot(sentence: str) -> bool:
    sentence = sentence or ""
    return bool(_OFFERS_SLOT.search(sentence)) and not _NOT_FREE.search(sentence)


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


# A promise to pass the request on, or that the team will come back to them
# ("I'll pass this on to the team", "the team will get back to you", "I've shared
# your details", "someone will call you").
_PASSES_ON = re.compile(
    r"\b(?:i(?:'|’)ll|i\s+will|i\s+can|i(?:'|’)ve|i\s+have|let\s+me|"
    r"we(?:'|’)ll|we\s+will)"
    r"\s+(?:also\s+)?(?:pass(?:ed)?|forward(?:ed)?|shar(?:e|ed)|send|sent|"
    r"let\s+(?:the|our)\s+team\s+know|notif(?:y|ied)|flag(?:ged)?)\b"
    r"|\b(?:the|our)\s+team\s+(?:will|would|can|should)\s+(?:get\s+back|reach\s+out|"
    r"contact|call|follow\s+up|be\s+in\s+touch|respond|reply)"
    r"|\bsomeone\s+(?:from\s+(?:the|our)\s+team\s+)?will\s+(?:get\s+back|reach\s+out|"
    r"contact|call|follow\s+up|be\s+in\s+touch)",
    re.IGNORECASE,
)


def passes_on(sentence: str) -> bool:
    return bool(_PASSES_ON.search(sentence or ""))


def _trim_pass_on_promises(verdict: Verdict, ctx: CheckContext) -> None:
    """With no `hand_over` and no list that takes their details, nothing passes a
    request on, so the reply never promises to (chunk 6b). The sentence is trimmed;
    a reply that then gives no way to reach the team gets the owner's contact and
    is sent back once to say how to reach the team from the information."""
    if ctx.can_pass_on or not passes_on(verdict.answer):
        return
    logger.info("Reply promises to pass something on, with nothing to do it")
    verdict.answer = without_sentences(verdict.answer, lambda s: not passes_on(s))
    if contact_details(verdict.answer):
        return
    contact = decline_contact(ctx)
    if contact:
        verdict.answer = f"{verdict.answer} {contact}".strip()
    if verdict.rejection is None:
        verdict.rejection, verdict.keeps_text = Rejection.REACH_TEAM, True


def _drop_record_ids(verdict: Verdict, ctx: CheckContext) -> None:
    """A record's id is for the tools, never the person (chunk 6): the model copies
    it from a passage's `id:` line, so it's taken out, with its label, and so is talk
    of records and citation numbers. Only in a run with record passages, so every
    other reply is exactly as before. Trimmed, not sent back."""
    if not any(passage.get("record_id") for passage in ctx.passages):
        return
    verdict.answer = without_record_ids(verdict.answer) or verdict.answer


def cite_offered_times(verdict: Verdict, ctx: CheckContext) -> None:
    """Cite the records that back the times a reply offers (chunk 6): the model often
    lists the right times without citing them. Runs before grounding, so a reply
    whose times are all backed counts as cited."""
    if not ctx.can_book:
        return
    backing, _ = ground_offered_times(verdict.answer, ctx.passages)
    cited = {citation.get("passage_number") for citation in verdict.citations}
    added = [number for number in backing if number not in cited]
    if added:
        verdict.citations = verdict.citations + resolve_citations(added, ctx.passages)


def _ground_offered_times(verdict: Verdict, ctx: CheckContext) -> None:
    """An assistant that can book (chunk 6) may present a time as free, or as booked,
    only from a find or write in this run. Each offered time is matched against the
    run's record passages: the records that back it are cited (the model often lists
    the right times without citing them), and a sentence offering a time no record
    backs is taken out and the draft sent back once. A day presented as free with no
    time ("Thursday is free") must cite a record, as before."""
    if not ctx.can_book:
        return
    cite_offered_times(verdict, ctx)
    _, unfounded = ground_offered_times(verdict.answer, ctx.passages)
    if unfounded:
        drop = set(unfounded)
        verdict.answer = without_sentences(
            verdict.answer, lambda s: s.strip() not in drop
        )
    elif not offers_slot(verdict.answer) or any(
        citation.get("record_id") for citation in verdict.citations
    ):
        return
    else:
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
    """Talk of sources, said in a person's words instead (Q3-fast Part 2, 17 Nov
    C2): the usual openers rewritten, the phrases cut in place, and any sentence
    still about sources dropped, so none of it reaches the person and no rewrite
    is spent on it. Only a reply with nothing else left is sent back."""
    text = without_source_phrases(in_a_persons_words(verdict.answer))
    kept = without_sentences(text, lambda sentence: not mentions_sources(sentence))
    verdict.answer = kept or text or verdict.answer


def _flag_source_talk(verdict: Verdict, ctx: CheckContext) -> None:
    """Wording, not safety: kept as written if the rewrite still does it."""
    if verdict.rejection is None and mentions_sources(verdict.answer):
        verdict.rejection, verdict.keeps_text = Rejection.MENTIONS_SOURCES, True


def _decline_if_nothing_left(verdict: Verdict, ctx: CheckContext) -> None:
    """Nothing left once the unsourced details were removed."""
    if verdict.keeps_text and not verdict.answer:
        verdict.intent, verdict.keeps_text = AgentIntent.DECLINE, False


#: A sentence about another channel's rules or the assistant's own instructions
#: (Q4 G2, Round 7 R4: "(On WhatsApp I won't ask for your phone number…" and "WhatsApp
#: par humare paas aapka number hai" on the web page).
#: Only the assistant's own WhatsApp rule (it has their number there), never a fact
#: about the organisation such as "You can book on WhatsApp".
_CHANNEL_TALK = re.compile(
    r"\bon whatsapp,? (I|we)\b"
    r"|\b(already|we) ha(?:ve|s) your (?:phone |mobile )?number\b"
    r"|\bwhatsapp (?:par|pe|mein) (?:humare|hamare|hamaare) paas\b"
    r"|\baapka (?:phone )?number (?:humare|hamare) paas\b",
    re.IGNORECASE,
)
_OWN_RULES_TALK = re.compile(
    r"\b(my|the) (instructions|system prompt|rules I follow)\b"
    r"|\bI(?:'m| am) (told|instructed|not allowed) to\b"
    r"|\bI (won'?t|will not|don'?t) ask for your (phone|number|mobile)\b",
    re.IGNORECASE,
)


def drop_channel_talk(verdict: Verdict, ctx: CheckContext) -> None:
    """Removed, not sent back (Q4 G2): talk of the assistant's own rules, and of
    WhatsApp anywhere but on WhatsApp. If nothing else is left, the reply stays."""

    def talks(sentence: str) -> bool:
        if _OWN_RULES_TALK.search(sentence):
            return True
        return ctx.channel != "whatsapp" and bool(_CHANNEL_TALK.search(sentence))

    if any(talks(s) for s in SENTENCE_END.split(verdict.answer)):
        verdict.answer = (
            without_sentences(verdict.answer, lambda s: not talks(s)) or verdict.answer
        )


#: "I don't have our crisis contact numbers here" (Q4 G7, Round 7 #6: at 2am).
_NO_CRISIS_NUMBERS = re.compile(
    r"\b(don'?t|do not|doesn'?t|does not)\s+have\s+(our |any |the |a )?"
    r"(crisis|emergency|helpline|support)\s+(contact\s+)?(numbers?|lines?|details)"
    r"|(crisis|helpline|emergency)\s+(numbers?|number)\s+(nahi|nahin|नहीं)",
    re.IGNORECASE,
)
#: Fixed text (Q4 G7; in Q4-PROMPTS.md for review): the national numbers, then the
#: organisation's own confirmed line when there is one.
CRISIS_NUMBERS_EN = (
    "If you need someone to talk to now, you can call Tele-MANAS on 14416 "
    "(free, 24×7), or 112 if you're in danger."
)
CRISIS_NUMBERS_HI = (
    "अगर आपको अभी किसी से बात करनी है, तो Tele-MANAS को 14416 पर कॉल करें "
    "(मुफ़्त, 24×7), या ख़तरे में हों तो 112 पर।"
)
CRISIS_NUMBERS_HI_LATN = (
    "Agar aapko abhi kisi se baat karni hai, toh Tele-MANAS ko 14416 par call karein "
    "(free, 24×7), ya khatre mein hon toh 112 par."
)
CRISIS_LINE_EN = " You can also reach {organisation} on {line}."
CRISIS_LINE_HI_LATN = " Aap {organisation} se {line} par bhi baat kar sakte hain."
#: Hinglish markers (Q4 B2): a reply written in Hinglish gets the Hinglish line.
_HINGLISH = re.compile(
    r"\b(aap|aapko|hai|hain|nahi|kya|mein|karein|kar|raha|rahi|yahan|abhi|toh)\b",
    re.IGNORECASE,
)
CRISIS_LINE_HI = " आप {organisation} से {line} पर भी संपर्क कर सकते हैं।"
_DEVANAGARI = re.compile(r"[\u0900-\u097F]")


def give_crisis_numbers(verdict: Verdict, ctx: CheckContext) -> None:
    """A reply never says it has no crisis numbers (Q4 G7): that sentence becomes
    the national numbers, and the organisation's own confirmed line."""
    sentences = SENTENCE_END.split(verdict.answer)
    if not any(_NO_CRISIS_NUMBERS.search(s) for s in sentences):
        return
    hindi = bool(_DEVANAGARI.search(verdict.answer))
    hinglish = not hindi and len(_HINGLISH.findall(verdict.answer)) >= 2
    if hindi:
        numbers, line = CRISIS_NUMBERS_HI, CRISIS_LINE_HI
    elif hinglish:
        numbers, line = CRISIS_NUMBERS_HI_LATN, CRISIS_LINE_HI_LATN
    else:
        numbers, line = CRISIS_NUMBERS_EN, CRISIS_LINE_EN
    if ctx.crisis_line:
        terms = ctx.organisation.terms
        organisation = terms[0] if terms else ("टीम" if hindi else "the team")
        numbers += line.format(organisation=organisation, line=ctx.crisis_line)
    kept = without_sentences(verdict.answer, lambda s: not _NO_CRISIS_NUMBERS.search(s))
    verdict.answer = f"{kept} {numbers}".strip() if kept else numbers


#: Applied in this order to every reply that isn't a decline the check forced.
WORDING_FIXES: Tuple[Callable[[Verdict, CheckContext], None], ...] = (
    _drop_record_ids,
    _keep_out_of_scope_declines_generic,
    _drop_unsourced_details,
    _trim_repeated_crisis_wording,
    _trim_repeated_topic_list,
    _trim_booking_offers,
    _trim_false_offers,
    _trim_pass_on_promises,
    _send_back_slot_offers,
    _ground_offered_times,
    _cut_source_phrases,
    _flag_source_talk,
    _decline_if_nothing_left,
)
