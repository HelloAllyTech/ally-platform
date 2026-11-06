"""Check for the conversational agent: what the model replied → what ally-be gets.

Deterministic, like the parity path's check. The model may chat freely, but a fact
about the organisation reaches a person only with a citation that resolves to a
passage this run actually offered.

The response keeps the `/knowledge-agent/answer` shape, so ally-be's decision mapping
is unchanged: small talk comes back as intent `answer` with no citations and
decline reason `none`, plus `turn_type`.

A draft the check refuses comes back with a rejection reason. The graph gives the
agent one chance to rewrite it (nodes/agent_check.py); only a second refusal
becomes a decline with no text, which ally-be sends as the bot's decline wording.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.schemas import REPLY_ACTION, AgentIntent
from app.core.config import settings
from app.core.knowledge_agent.agent import KnowledgeAgentService
from app.core.knowledge_agent.schemas import AnswerIntent, DeclineReason
from app.utils.logger import get_logger

logger = get_logger(__name__)

# Small talk that carries a number, a price, a percentage, a link or an email is
# asserting something checkable, so it has to be grounded like an answer. Errs on
# the side of treating harmless text as factual: the cost is a decline, the
# alternative an invented price.
_LOOKS_FACTUAL = re.compile(
    r"\d|[₹$€£%]|\b(?:rs|inr|usd|eur)\b|https?://|www\.|[\w.+-]+@[\w-]+\.\w+",
    re.IGNORECASE,
)


def looks_factual(text: str) -> bool:
    return bool(_LOOKS_FACTUAL.search(text or ""))


# What kind of checkable detail a text carries, in the words the rewrite is told.
# Kinds only: the refused text itself is never shown back to the model.
_DETAIL_KINDS = (
    ("a link", re.compile(r"https?://|www\.", re.IGNORECASE)),
    ("an email address", re.compile(r"[\w.+-]+@[\w-]+\.\w+")),
    (
        "a price or percentage",
        re.compile(r"[₹$€£%]|\b(?:rs|inr|usd|eur)\b", re.IGNORECASE),
    ),
    ("a number", re.compile(r"\d")),
)


_URL = re.compile(r"(?:https?://|www\.)[^\s<>()\[\]]+", re.IGNORECASE)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_NUMBER = re.compile(r"\d[\d\s-]*\d|\d")


def _normalise_detail(detail: str) -> str:
    detail = re.sub(r"^https?://", "", detail.lower()).rstrip(".,;:!?/'\"")
    return re.sub(r"[\s-]", "", detail)


def unsupported_details(text: str, passages: Sequence[Dict[str, Any]]) -> List[str]:
    """Links, emails and numbers in `text` that no passage contains."""
    corpus = _normalise_detail(" ".join(str(p.get("text") or "") for p in passages))
    found = [*_URL.findall(text or ""), *_EMAIL.findall(text or "")]
    without_links = _EMAIL.sub(" ", _URL.sub(" ", text or ""))
    found += _NUMBER.findall(without_links)
    return [d for d in found if _normalise_detail(d) not in corpus]


# Markdown the model sometimes writes anyway. WhatsApp shows it as literal symbols, so
# a reply goes out as plain text: a link as its bare URL, no bold, no headings.
_MD_LINK = re.compile(r"\[([^\]]*)\]\(\s*([^)\s]+)\s*\)")
_MD_BOLD = re.compile(r"(\*\*|__)(.+?)\1", re.DOTALL)
_MD_STAR = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")
_MD_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+", re.MULTILINE)


def plain_text(text: str) -> str:
    """`text` without markdown: ``[text](url)`` → ``url``; bold and headings dropped."""
    text = _MD_LINK.sub(lambda m: m.group(2), text or "")
    text = _MD_BOLD.sub(lambda m: m.group(2), text)
    text = _MD_STAR.sub(lambda m: m.group(1), text)
    return _MD_HEADING.sub("", text).strip()


#: Words in a bot's or a document's name that don't identify an organisation.
_GENERIC_NAME_WORDS = {
    "faq",
    "faqs",
    "bot",
    "chatbot",
    "assistant",
    "helper",
    "help",
    "support",
    "desk",
    "chat",
    "team",
    "info",
    "the",
    "and",
    "for",
    "guide",
    "docs",
}


@dataclass(frozen=True)
class Organisation:
    """How the check recognises a message or reply about the organisation."""

    #: The bot's own name: masked first, so "I'm Ally FAQ" is not about the
    #: organisation.
    self_names: Tuple[str, ...] = ()
    #: Names that mean the organisation or its product.
    terms: Tuple[str, ...] = field(default_factory=tuple)

    def named_in(self, text: str) -> bool:
        if not self.terms or not text:
            return False
        for name in self.self_names:
            text = re.sub(re.escape(name), " ", text, flags=re.IGNORECASE)
        return any(
            re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.IGNORECASE)
            for term in self.terms
        )


def organisation_of(bot: Dict[str, Any]) -> Organisation:
    """The organisation's names, from the bot: its display name and the name its
    documents share ("Ally FAQ – About Ally" → "Ally FAQ"), plus their distinctive
    words ("Ally"). A bot with neither has no names, and only citations apply."""
    persona = bot.get("persona") or {}
    display = (persona.get("display_name") or "").strip()
    names: List[str] = [display] if display else []
    for topic in bot.get("knowledge_topics") or []:
        prefix = re.split(r"\s[–—-]\s", topic, maxsplit=1)
        if len(prefix) == 2 and prefix[0].strip():
            names.append(prefix[0].strip())
    terms: List[str] = []
    for name in names:
        terms.append(name)
        terms += [
            word
            for word in re.findall(r"[\w']+", name)
            if len(word) >= 3
            and word[0].isupper()
            and word.lower() not in _GENERIC_NAME_WORDS
        ]
    unique = tuple(dict.fromkeys(t for t in terms if t))
    return Organisation(self_names=(display,) if display else (), terms=unique)


# Talk about where answers come from ("my reference material", "the documents"),
# which a person shouldn't hear. Specific phrases only: "documents" alone may be a
# product feature.
_MENTIONS_SOURCES = re.compile(
    r"reference material|knowledge ?base|\bpassages?\b"
    r"|\b(?:my|the|our|these|those|provided|given|diye gaye)"
    r"\s+(?:documents|docs|sources)\b",
    re.IGNORECASE,
)


def mentions_sources(text: str) -> bool:
    return bool(_MENTIONS_SOURCES.search(text or ""))


def detail_kinds(text: str) -> List[str]:
    """The kinds of checkable detail in `text`, e.g. ``["a link", "a number"]``."""
    return [kind for kind, pattern in _DETAIL_KINDS if pattern.search(text or "")]


def rejection_feedback(
    rejection: str, step: Dict[str, Any], *, searched: bool = True
) -> str:
    """What the rewrite is told: the reason, naming the kinds of unsourced detail,
    and to search first when the refused draft was written without searching."""
    feedback = REJECTIONS[rejection]
    if rejection == "unsourced_detail":
        kinds = detail_kinds(step.get("answer") or "")
        if kinds:
            feedback += f" It contained {' and '.join(kinds)}."
    if not searched and rejection not in ("empty", "search_first", "mentions_sources"):
        feedback += " You haven't searched yet: search before you reply."
    return feedback


#: Why a draft was refused, as told to the agent when it rewrites it. Plain
#: guidance, never the refused text.
REJECTIONS: Dict[str, str] = {
    "uncited": (
        "It stated something about the organisation without citing a passage. "
        "Cite the passages that support it; if none do and searches are left, "
        "search; otherwise tell the person, in your own words, that you don't have "
        "that information and where they could go instead."
    ),
    "unsourced_detail": (
        "It included a specific detail (a number, price, link, email or contact) "
        "that no passage supports. Leave the detail out, or cite the passage it "
        "comes from."
    ),
    "empty": "It was empty. Write the reply the person should get.",
    "search_first": (
        "It said it doesn't have this without searching. Search first: the answer "
        "may be in the library."
    ),
    "mentions_sources": (
        "It talked about its reference material, documents or passages. Say the same "
        "as someone who simply knows, or doesn't: no talk of sources."
    ),
    "use_found": (
        "A search found passages about this, so don't say you don't have it: answer "
        "from those passages and cite them."
    ),
}


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
) -> Tuple[Dict[str, Any], Optional[str]]:
    """The run's result, and the rejection reason (a `REJECTIONS` key) when the
    check refused the draft; None when it went through as the model meant it.

    `search_gate` is the gate verdict on the run's first search (None when it
    found something relevant or no search ran). `searched` is whether a search ran
    this run at all.

    The organisation is never general knowledge. A message naming it, or an answer
    to a question that names it, needs a citation whatever the answer mode; a bot
    allowed general knowledge may answer uncited only about something else, and
    only after a search this run found nothing relevant.
    """
    action = step.get("action") or REPLY_ACTION
    intent = AgentIntent(step.get("intent") or AgentIntent.DECLINE)
    answer_text = plain_text(step.get("answer") or "")
    citations = KnowledgeAgentService._resolve_citations(
        list(step.get("citations") or []), passages
    )
    unsupported = False
    rejection: Optional[str] = None
    # The model chose to decline, so its text is a decline written for the person.
    # A decline forced here replaces whatever the model wrote, which may be the
    # very claim being refused; ally-be then sends the bot's decline wording.
    model_declined = action == REPLY_ACTION and intent == AgentIntent.DECLINE
    about_organisation = organisation.named_in(question) or (
        turn_type == "question" and organisation.named_in(answer_text)
    )

    if action != REPLY_ACTION:
        # The tool budget ran out and the model still asked for a tool: it has
        # nothing it is willing to answer with.
        logger.info("Agent asked for a tool past its budget; declining")
        intent = AgentIntent.DECLINE
        rejection = "empty"
    elif not answer_text:
        intent = AgentIntent.DECLINE
        rejection = "empty"
    elif (
        intent == AgentIntent.ANSWER
        and not step.get("citations")
        and turn_type in ("smalltalk", "about_bot")
        and not passages
        and not looks_factual(answer_text)
        and not about_organisation
    ):
        # A reply to a greeting or to "what can you do?", labelled `answer` with
        # nothing searched or cited, is small talk: the same text sent as
        # `smalltalk` would pass, so refusing it only swaps in the fixed wording.
        intent = AgentIntent.SMALLTALK
    elif intent == AgentIntent.SMALLTALK and (looks_factual(answer_text) or passages):
        # Small talk does not need a source, but this one either states something
        # checkable or was written after a search found passages: ground it like
        # an answer.
        logger.info("Small talk looks factual; treating it as an answer")
        intent = AgentIntent.ANSWER
        rejection = "unsourced_detail"
    elif intent == AgentIntent.SMALLTALK and about_organisation:
        # "What is Ally?" answered as small talk is an answer about the
        # organisation: it needs a source like any other.
        intent = AgentIntent.ANSWER
        rejection = "uncited"

    if intent == AgentIntent.ANSWER and not citations:
        if general and searched and not passages and not about_organisation:
            # General knowledge, on a bot allowed it: about something other than
            # the organisation, and only once a search found nothing. Flagged as
            # ungrounded, as today.
            unsupported = True
            rejection = None
        else:
            logger.info("Agent answer with no valid citations; declining")
            intent = AgentIntent.DECLINE
            rejection = rejection or "uncited"
    elif intent != AgentIntent.DECLINE:
        rejection = None
    elif model_declined and rejection is None:
        if organisation.named_in(question) and not searched:
            # "Does Ally store audio?" → "I don't have that": it never looked.
            logger.info("Agent declined about the organisation without searching")
            rejection = "search_first"
        elif passages and organisation.named_in(question):
            # It searched, found passages about the organisation, and still said
            # it doesn't have it.
            logger.info("Agent declined although a search found passages")
            rejection = "use_found"
        elif unsupported_details(answer_text, passages):
            # A decline is the model's own words, but a link, email or number in
            # it still needs a passage that says it.
            logger.info("Agent decline carries an unsourced detail")
            rejection = "unsourced_detail"

    style_only = False
    if rejection is None and mentions_sources(answer_text):
        # Wording, not safety: sent back once to rephrase, and kept as written if
        # the rewrite still does it.
        rejection = "mentions_sources"
        style_only = True

    if intent == AgentIntent.DECLINE:
        citations = []
        if not model_declined or (rejection and not style_only):
            answer_text = ""
        # The parity path's reason when searching found nothing at all, so the
        # unanswered queue reads the same as in v1.
        decline_reason = (
            DeclineReason(search_gate)
            if search_gate and not passages
            else DeclineReason.MODEL_DECLINED
        )
    else:
        decline_reason = DeclineReason.NONE
        if intent in (AgentIntent.SMALLTALK, AgentIntent.CLARIFY):
            citations = []

    response_intent = {
        AgentIntent.ANSWER: AnswerIntent.ANSWER,
        AgentIntent.SMALLTALK: AnswerIntent.ANSWER,
        AgentIntent.CLARIFY: AnswerIntent.CLARIFY,
        AgentIntent.DECLINE: AnswerIntent.DECLINE,
    }[intent]
    retrieval = {
        **retrieval,
        "passages_used": len(passages),
        "unsupported": unsupported,
    }

    result = {
        "intent": response_intent,
        "answer": answer_text,
        "language": (step.get("language") or language or "en").strip(),
        "confidence": 0.0,
        "citations": citations,
        "decline_reason": decline_reason,
        "retrieval": retrieval,
        "provider": meta.get("provider", ""),
        "model": meta.get("model", ""),
        "prompt_version": settings.KNOWLEDGE_AGENT.PROMPT_VERSION,
        "turn_type": turn_type,
    }
    return result, rejection
