"""The check, phase by phase: read the draft, ground it, fix its wording (fixes.py),
then build the response ally-be gets.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.check.fixes import (
    WORDING_FIXES,
    add_fallback_contact,
    cite_offered_times,
    drop_channel_talk,
    give_crisis_numbers,
)
from app.core.agent_runtime.check.organisation import Organisation
from app.core.agent_runtime.check.personal import about_the_person
from app.core.agent_runtime.check.rejections import Rejection
from app.core.agent_runtime.check.safety import (
    enforce_avoid_topics,
    enforce_safety_pack,
)
from app.core.agent_runtime.check.text import (
    looks_factual,
    plain_text,
    says_it_has_nothing,
    without_contact_details,
    without_sentences,
)
from app.core.agent_runtime.check.verdict import CheckContext, Verdict
from app.core.agent_runtime.schemas import REPLY_ACTION, AgentIntent
from app.core.knowledge_agent.agent import AnswerResult, build_result, resolve_citations
from app.core.knowledge_agent.schemas import AnswerIntent, DeclineReason
from app.utils.logger import get_logger

# Logged under the package name, as when this was one module.
logger = get_logger(__package__)


def check_reply(
    step: Dict[str, Any],
    meta: Dict[str, Any],
    passages: List[Dict[str, Any]],
    *,
    turn_type: str,
    language: str,
    retrieval: Dict[str, Any],
    general: bool,
    search_gate: Optional[str],
    question: str = "",
    searched: bool = False,
    organisation: Organisation = Organisation(),
    history: Sequence[Dict[str, str]] = (),
    safety_pack: Optional[str] = None,
    can_search_again: bool = False,
    decline_text: Optional[str] = None,
    avoid_topics: Sequence[str] = (),
    purpose: Optional[str] = None,
    can_book: bool = False,
    personal: str = "",
    looked_up: bool = False,
    found_nothing: bool = False,
    can_pass_on: bool = True,
    carried: int = 0,
    refused: Sequence[str] = (),
    business_contact: str = "",
    memory_on: bool = True,
    channel: str = "",
    crisis_line: str = "",
    upset: bool = False,
    books: bool = False,
    looks_up: bool = False,
) -> Tuple[AnswerResult, Optional[Rejection]]:
    """The run's result, and the rejection reason when the check refused the draft;
    None when it went through as the model meant it.

    Four phases, in order: read the draft (`_read_draft`), decide whether it is
    grounded (`_ground`), fix its wording (`WORDING_FIXES`), and build the result.

    The organisation is never general knowledge. A message naming it, or an answer
    to a question that names it, needs a citation whatever the answer mode; a bot
    allowed general knowledge may answer uncited only about something else, and
    only after a search this run found nothing relevant.
    """
    ctx = CheckContext(
        passages=passages,
        turn_type=turn_type,
        general=general,
        search_gate=search_gate,
        question=question,
        searched=searched,
        organisation=organisation,
        history=history,
        safety_pack=safety_pack,
        can_search_again=can_search_again,
        decline_text=(decline_text or "").strip(),
        avoid_topics=tuple(avoid_topics),
        purpose=purpose,
        can_book=can_book,
        personal=personal,
        looked_up=looked_up,
        found_nothing=found_nothing,
        can_pass_on=can_pass_on,
        carried=carried,
        refused=tuple(refused),
        business_contact=(business_contact or "").strip(),
        memory_on=memory_on,
        channel=(channel or "").strip().lower(),
        crisis_line=(crisis_line or "").strip(),
        upset=upset,
        books=books,
        looks_up=looks_up,
    )
    verdict = _read_draft(step, ctx)
    say_memory_is_off(verdict, ctx)
    # A list's times are cited from the run's records before grounding (chunk 6).
    cite_offered_times(verdict, ctx)
    _ground(verdict, step, ctx)
    # Safety before wording, and on every reply, declines included: the pack's rules
    # outrank everything the instructions or the model say.
    enforce_safety_pack(verdict, ctx)
    enforce_avoid_topics(verdict, ctx)
    # Fixes that keep the rest of the reply: sent back once, and if the rewrite
    # still needs them, applied to the text (sentences removed) rather than
    # refusing the reply.
    if verdict.intent != AgentIntent.DECLINE or verdict.model_declined:
        for fix in WORDING_FIXES:
            fix(verdict, ctx)
    # On every reply, declines included (Q4 G2, G7).
    drop_channel_talk(verdict, ctx)
    give_crisis_numbers(verdict, ctx)
    add_fallback_contact(verdict, ctx)
    result = _build_result(verdict, step, meta, ctx, language, retrieval)
    return result, verdict.rejection


# ------------------------------------------------------------------ 1. read the draft


def _read_draft(step: Dict[str, Any], ctx: CheckContext) -> Verdict:
    """The draft as plain text with its citations resolved. An answer that opens by
    saying it has nothing is the decline it is."""
    replied = (step.get("action") or REPLY_ACTION) == REPLY_ACTION
    intent = AgentIntent(step.get("intent") or AgentIntent.DECLINE)
    answer = plain_text(step.get("answer") or "")
    # "I don't have any slots on Thursday evening" after a find that found none is
    # the find's answer, not a decline (chunk 6b).
    if (
        replied
        and intent == AgentIntent.ANSWER
        and not ctx.found_nothing
        and says_it_has_nothing(answer)
    ):
        logger.info("Answer opens by saying it has nothing; treating it as a decline")
        intent = AgentIntent.DECLINE
    return Verdict(
        intent=intent,
        answer=answer,
        citations=resolve_citations(list(step.get("citations") or []), ctx.passages),
        model_declined=replied and intent == AgentIntent.DECLINE,
    )


# ------------------------------------------------------------------ 2. grounding


def _ground(verdict: Verdict, step: Dict[str, Any], ctx: CheckContext) -> None:
    """Relabel the draft for what it really is, then require a source for anything
    it states about the organisation."""
    about_organisation = ctx.organisation.named_in(ctx.question) or (
        ctx.turn_type == "question" and ctx.organisation.named_in(verdict.answer)
    )
    _relabel(verdict, step, ctx, about_organisation)
    _require_sources(verdict, ctx, about_organisation)


def _relabel(
    verdict: Verdict,
    step: Dict[str, Any],
    ctx: CheckContext,
    about_organisation: bool,
) -> None:
    factual = looks_factual(without_contact_details(verdict.answer))
    if (step.get("action") or REPLY_ACTION) != REPLY_ACTION:
        # The tool budget ran out and the model still asked for a tool: it has
        # nothing it is willing to answer with.
        logger.info("Agent asked for a tool past its budget; declining")
        verdict.intent, verdict.rejection = AgentIntent.DECLINE, Rejection.EMPTY
    elif not verdict.answer:
        verdict.intent, verdict.rejection = AgentIntent.DECLINE, Rejection.EMPTY
    elif (
        verdict.intent in (AgentIntent.ANSWER, AgentIntent.SMALLTALK)
        and not step.get("citations")
        and not about_organisation
        and about_the_person(verdict.answer, ctx.personal)
    ):
        # "What time did I say suits me?" answered from what it was given about the
        # person (chunk 8a): their own words, so no passage can cite it. Sent as a
        # personal reply, uncited, like small talk.
        verdict.intent, verdict.rejection = AgentIntent.SMALLTALK, None
    elif (
        verdict.intent == AgentIntent.ANSWER
        and not step.get("citations")
        and ctx.turn_type in ("smalltalk", "about_bot")
        and not ctx.found
        and not factual
        and not about_organisation
    ):
        # A reply to a greeting or to "what can you do?", labelled `answer` with
        # nothing searched or cited, is small talk: the same text sent as
        # `smalltalk` would pass, so refusing it only swaps in the fixed wording.
        verdict.intent = AgentIntent.SMALLTALK
    elif verdict.intent == AgentIntent.SMALLTALK and (factual or ctx.found):
        # Small talk does not need a source, but this one either states something
        # checkable (a time, a price) or was written after a search found passages:
        # ground it like an answer. Phone numbers, links and emails are checked
        # for every reply (WORDING_FIXES).
        logger.info("Small talk looks factual; treating it as an answer")
        verdict.intent = AgentIntent.ANSWER
        verdict.rejection = Rejection.UNSOURCED_DETAIL
    elif verdict.intent == AgentIntent.SMALLTALK and about_organisation:
        # "What is Ally?" answered as small talk is an answer about the
        # organisation: it needs a source like any other.
        verdict.intent, verdict.rejection = AgentIntent.ANSWER, Rejection.UNCITED


def _require_sources(
    verdict: Verdict, ctx: CheckContext, about_organisation: bool
) -> None:
    if relays_refusal(verdict, ctx):
        # "That table is taken; T3 is free", "You already have 2 bookings": the
        # list's own refusal of this run's booking, in plain words (Q3-fast Part
        # 0b). It is the answer to what the person asked, so it goes out as one,
        # never as the fixed decline, and never counts toward a hand-over.
        verdict.intent, verdict.rejection = AgentIntent.ANSWER, None
        return
    if verdict.intent == AgentIntent.ANSWER and not verdict.citations:
        if answers_from_empty_find(verdict.answer, ctx):
            # "Nothing's free on Thursday evening": a find this run found nothing at
            # the time asked (chunk 6b). An empty find is an answer, not a missing
            # source; there is no entry to cite, and the reply states no detail a
            # record of this run doesn't show.
            verdict.rejection = None
        elif ctx.general and ctx.searched and not ctx.found and not about_organisation:
            # General knowledge, on a bot allowed it: about something other than
            # the organisation, and only once a search found nothing. Flagged as
            # ungrounded, as today.
            verdict.unsupported, verdict.rejection = True, None
        else:
            logger.info("Agent answer with no valid citations; declining")
            verdict.intent = AgentIntent.DECLINE
            verdict.rejection = verdict.rejection or Rejection.UNCITED
    elif verdict.intent != AgentIntent.DECLINE:
        verdict.rejection = None
    elif verdict.model_declined and verdict.rejection is None:
        names_it = ctx.organisation.named_in(ctx.question)
        if names_it and not ctx.searched and not ctx.looked_up:
            # "Does Ally store audio?" → "I don't have that": it never looked.
            logger.info("Agent declined about the organisation without searching")
            verdict.rejection = Rejection.SEARCH_FIRST
        elif ctx.found and names_it:
            # It searched, found passages about the organisation, and still said
            # it doesn't have it.
            logger.info("Agent declined although a search found passages")
            # A nudge: the passages may be about something else, so a decline the
            # rewrite still chooses is kept in its own words.
            verdict.rejection, verdict.keeps_text = Rejection.USE_FOUND, True
        elif ctx.can_search_again and ctx.found and ctx.turn_type == "question":
            # One search, it found passages but not the answer, and the agent gave
            # up. On short web pages the first query often lands on a heading; a
            # second query with other words found the answer every time in the
            # 20a eval's reruns (chunk 20a-2). Kept in its own words if the rewrite
            # still declines.
            logger.info("Agent declined after one search; searching again")
            verdict.rejection, verdict.keeps_text = Rejection.SEARCH_AGAIN, True


_NUMBER = re.compile(r"\d+")

# "Please remember…", "remember that I…", "yaad rakhna" (Q3-fast Part 2, 17 Nov M2).
_ASKS_TO_REMEMBER = re.compile(
    r"\b(?:please\s+)?remember\b(?!\s+(?:me\s+)?(?:when|what|if|how))"
    r"|\bnote\s+(?:that|this|down)\b"
    r"|\byaad\s+(?:rakh|rakhna|rakhiye|rakhein)",
    re.IGNORECASE,
)
# A promise to remember for later, which nothing will keep with memory off.
_PROMISES_TO_REMEMBER = re.compile(
    r"\b(?:i['’]ll|i\s+will|i['’]ve|i\s+have|we['’]ll)\s+(?:\w+\s+)?"
    r"(?:remember|noted|note|save|saved|keep)"
    r"|\bnext\s+time\b|\bfor\s+(?:the\s+)?future\b",
    re.IGNORECASE,
)
#: Fixed, honest, not the decline voice (Q3-fast Part 2).
MEMORY_OFF_REPLY = (
    "I can't remember details between chats, but I'll use them for the rest of "
    "this one."
)


def say_memory_is_off(verdict: Verdict, ctx: CheckContext) -> None:
    """With memory off, "please remember…" gets a plain answer (Q3-fast Part 2, 17 Nov
    M2: it got "I don't know that; please contact us"): a decline becomes the fixed
    line, and a promise to remember for later is replaced by it."""
    if ctx.memory_on or not _ASKS_TO_REMEMBER.search(ctx.question or ""):
        return
    if verdict.intent == AgentIntent.DECLINE or not verdict.answer.strip():
        verdict.intent, verdict.answer = AgentIntent.SMALLTALK, MEMORY_OFF_REPLY
        verdict.model_declined, verdict.citations = False, []
        return
    if _PROMISES_TO_REMEMBER.search(verdict.answer):
        kept = without_sentences(
            verdict.answer, lambda s: not _PROMISES_TO_REMEMBER.search(s)
        )
        verdict.answer = f"{MEMORY_OFF_REPLY} {kept}".strip()
        if not verdict.citations:
            # About the person's own details: a personal reply, uncited, like 8a's.
            verdict.intent = AgentIntent.SMALLTALK


def relays_refusal(verdict: Verdict, ctx: CheckContext) -> bool:
    """An uncited reply, labelled an answer or declined by the model itself, after
    a list write this run was refused by the list's rules (Q3-fast Part 0b), that
    states no number the run didn't see: in the refusal, a record or passage it
    was shown, or the conversation."""
    if not ctx.refused or verdict.citations or not verdict.answer.strip():
        return False
    if verdict.intent == AgentIntent.DECLINE and not verdict.model_declined:
        return False
    if verdict.intent not in (AgentIntent.ANSWER, AgentIntent.DECLINE):
        return False
    seen = " ".join(
        [
            *ctx.refused,
            ctx.question,
            *(m.get("content") or "" for m in ctx.history),
            *(
                f"{p.get('section_path') or ''} {p.get('text') or ''}"
                for p in ctx.passages
            ),
        ]
    )
    shown = set(_NUMBER.findall(seen))
    return all(number in shown for number in _NUMBER.findall(verdict.answer))


def answers_from_empty_find(answer: str, ctx: CheckContext) -> bool:
    """An uncited reply that a find which found nothing answers (chunk 6b): every
    number in it (a time, a day of the month) appears in a list record of this run,
    so it states nothing the run didn't look up."""
    if not ctx.found_nothing or not answer.strip():
        return False
    records = " ".join(
        f"{p.get('section_path') or ''} {p.get('text') or ''}"
        for p in ctx.passages
        if p.get("record_id")
    )
    shown = set(_NUMBER.findall(records))
    return all(number in shown for number in _NUMBER.findall(answer))


# ------------------------------------------------------------------ 4. the result

#: The agent's intents as the `/knowledge-agent/answer` response has them: small talk
#: is an uncited answer.
_RESPONSE_INTENT = {
    AgentIntent.ANSWER: AnswerIntent.ANSWER,
    AgentIntent.SMALLTALK: AnswerIntent.ANSWER,
    AgentIntent.CLARIFY: AnswerIntent.CLARIFY,
    AgentIntent.DECLINE: AnswerIntent.DECLINE,
}


def _build_result(
    verdict: Verdict,
    step: Dict[str, Any],
    meta: Dict[str, Any],
    ctx: CheckContext,
    language: str,
    retrieval: Dict[str, Any],
) -> AnswerResult:
    answer, citations = verdict.answer, verdict.citations
    if verdict.intent == AgentIntent.DECLINE:
        citations = []
        if not verdict.model_declined or (verdict.rejection and not verdict.keeps_text):
            answer = ""
        # v1's reason when searching found nothing at all, so the
        # unanswered queue reads the same as in v1.
        decline_reason = (
            DeclineReason(ctx.search_gate)
            if ctx.search_gate and not ctx.found
            else DeclineReason.MODEL_DECLINED
        )
    else:
        decline_reason = DeclineReason.NONE
        if verdict.intent == AgentIntent.SMALLTALK:
            citations = []
        elif verdict.intent == AgentIntent.CLARIFY:
            # A clarify carries no document citations, as before; a list record's
            # it keeps (chunk 6): "which of these should I book?" offers free times,
            # and they must show where they came from.
            citations = [c for c in citations if c.get("record_id")]

    result = build_result(
        intent=_RESPONSE_INTENT[verdict.intent],
        answer=answer,
        language=(step.get("language") or language or "en").strip(),
        confidence=0.0,
        citations=citations,
        decline_reason=decline_reason,
        retrieval={
            **retrieval,
            "passages_used": len(ctx.passages),
            "unsupported": verdict.unsupported,
        },
        meta=meta,
    )
    result["turn_type"] = ctx.turn_type
    return result
