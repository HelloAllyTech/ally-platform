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
from enum import StrEnum
from typing import Any, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.schemas import REPLY_ACTION, AgentIntent
from app.core.knowledge_agent.agent import AnswerResult, build_result, resolve_citations
from app.core.knowledge_agent.schemas import AnswerIntent, DeclineReason
from app.utils.logger import get_logger

logger = get_logger(__name__)

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


def looks_factual(text: str) -> bool:
    """Whether `text` carries any checkable detail (a number, a price, a percentage,
    a link or an email). Small talk that does is asserting something, so it has to
    be grounded like an answer. Errs on the side of treating harmless text as
    factual: the cost is a decline, the alternative an invented price."""
    return any(pattern.search(text or "") for _, pattern in _DETAIL_KINDS)


_URL = re.compile(
    r"(?:https?://|www\.)[^\s<>()\[\]]+|\b[\w-]+(?:\.[\w-]+)*\.(?:ai|com|org|net|in|io)"
    r"(?:/[^\s<>()\[\]]*)?",
    re.IGNORECASE,
)
_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
# A phone-like number: three or more digits, spaces or dashes allowed between them.
# "Step 1" or "5 days" is not a contact; "112", "14416" and "1800-123-456" are.
_PHONE = re.compile(r"\+?\d(?:[\s-]?\d){2,}")


def _normalise_detail(detail: str) -> str:
    detail = re.sub(r"^https?://", "", detail.lower()).rstrip(".,;:!?/'\"")
    return re.sub(r"[\s+-]", "", detail)


def contact_details(text: str) -> List[str]:
    """Phone numbers, links and emails in `text`, as written."""
    text = text or ""
    emails = _EMAIL.findall(text)
    without_emails = _EMAIL.sub(" ", text)
    links = _URL.findall(without_emails)
    without_links = _URL.sub(" ", without_emails)
    return [*emails, *links, *_PHONE.findall(without_links)]


def without_contact_details(text: str) -> str:
    """`text` with its phone numbers, links and emails blanked out."""
    for detail in contact_details(text):
        text = text.replace(detail, " ")
    return text


def unsupported_details(text: str, passages: Sequence[Dict[str, Any]]) -> List[str]:
    """Phone numbers, links and emails in `text` that no passage contains."""
    corpus = _normalise_detail(" ".join(str(p.get("text") or "") for p in passages))
    return [d for d in contact_details(text) if _normalise_detail(d) not in corpus]


_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")


def without_sentences(text: str, keep: Any) -> str:
    """`text` with the sentences `keep(sentence)` rejects removed, line by line."""
    lines = []
    for line in (text or "").split("\n"):
        kept = [s for s in _SENTENCE_END.split(line) if s.strip() and keep(s)]
        if kept or not line.strip():
            lines.append(" ".join(kept))
    return re.sub(r"\n{3,}", "\n\n", "\n".join(lines)).strip()


def without_details(text: str, details: Sequence[str]) -> str:
    """`text` without the sentences that carry any of `details`."""
    return without_sentences(
        text, lambda sentence: not any(d in sentence for d in details)
    )


# Markdown the model sometimes writes anyway. WhatsApp shows it as literal symbols, so
# a reply goes out as plain text: a link as its bare URL, no bold, no headings.
_MD_LINK = re.compile(r"\[([^\]]*)\]\(\s*([^)\s]+)\s*\)")
_MD_BOLD = re.compile(r"(\*\*|__)(.+?)\1", re.DOTALL)
_MD_STAR = re.compile(r"(?<![\w*])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![\w*])")
_MD_HEADING = re.compile(r"^[ \t]*#{1,6}[ \t]+", re.MULTILINE)


# Both grammatical genders written at once in Hindi ("sakta/ti", "karunga/karungi"):
# a person writes one form, so the first is kept.
_BOTH_GENDERS = re.compile(
    r"\b(\w+?(?:ta|ga|ra|la|na|ya|aa))\s*/\s*\w*?(?:ti|gi|ri|li|ni|yi|ii)\b",
    re.IGNORECASE,
)


def plain_text(text: str) -> str:
    """`text` as one person would write it on WhatsApp: no markdown (``[text](url)``
    → ``url``; bold and headings dropped) and one gender form in Hindi."""
    text = _MD_LINK.sub(lambda m: m.group(2), text or "")
    text = _MD_BOLD.sub(lambda m: m.group(2), text)
    text = _MD_STAR.sub(lambda m: m.group(1), text)
    text = _BOTH_GENDERS.sub(lambda m: m.group(1), text)
    return _MD_HEADING.sub("", text).strip()


# Crisis wording. Said once, when the bot introduces itself; small talk later in a
# conversation doesn't repeat it, and nothing repeats "not a crisis service".
_CRISIS = re.compile(r"crisis|emergency|helpline|tele-?manas", re.IGNORECASE)
_NOT_A_CRISIS_SERVICE = re.compile(
    r"not a crisis|crisis service nahi|crisis service nahin|crisis line nahi",
    re.IGNORECASE,
)


def repeated_crisis_wording(
    text: str, turn_type: str, history: Sequence[Dict[str, str]]
) -> bool:
    """Whether `text` repeats crisis wording the conversation doesn't need again."""
    earlier = " ".join(
        turn.get("content") or "" for turn in history if turn.get("role") == "assistant"
    )
    if (
        earlier
        and _NOT_A_CRISIS_SERVICE.search(earlier)
        and (_NOT_A_CRISIS_SERVICE.search(text))
    ):
        return True
    return bool(earlier and turn_type == "smalltalk" and _CRISIS.search(text))


def without_repeated_crisis_wording(
    text: str, turn_type: str, history: Sequence[Dict[str, str]]
) -> str:
    pattern = _CRISIS if turn_type == "smalltalk" else _NOT_A_CRISIS_SERVICE
    return without_sentences(text, lambda sentence: not pattern.search(sentence))


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
    #: What the bot covers, by document title ("About Ally", "Privacy and Data").
    topics: Tuple[str, ...] = field(default_factory=tuple)

    def topics_named_in(self, text: str) -> int:
        """How many topics `text` mentions, by any of a topic's distinctive words
        ("Getting Access and Signing In" by "access" or "signing"): a topic list
        when three or more."""
        lowered = (text or "").lower()
        return sum(
            1
            for topic in self.topics
            if any(
                re.search(rf"\b{re.escape(word)}", lowered)
                for word in _topic_words(topic)
            )
        )

    def named_in(self, text: str) -> bool:
        if not self.terms or not text:
            return False
        for name in self.self_names:
            text = re.sub(re.escape(name), " ", text, flags=re.IGNORECASE)
        return any(
            re.search(rf"(?<!\w){re.escape(term)}(?!\w)", text, re.IGNORECASE)
            for term in self.terms
        )


_TOPIC_STOPWORDS = {"about", "getting", "using", "where", "what", "with", "their"}


def _topic_words(topic: str) -> List[str]:
    """A topic's distinctive words: five letters or more, not filler."""
    return [
        word
        for word in re.findall(r"[a-z]+", topic.lower())
        if len(word) >= 5 and word not in _TOPIC_STOPWORDS
    ]


def organisation_of(bot: Dict[str, Any]) -> Organisation:
    """The organisation's names, from the bot: its display name and the name its
    documents share ("Ally FAQ – About Ally" → "Ally FAQ"), plus their distinctive
    words ("Ally"). A bot with neither has no names, and only citations apply."""
    persona = bot.get("persona") or {}
    display = (persona.get("display_name") or "").strip()
    names: List[str] = [display] if display else []
    topics: List[str] = []
    for topic in bot.get("knowledge_topics") or []:
        prefix = re.split(r"\s[–—-]\s", topic, maxsplit=1)
        if len(prefix) == 2 and prefix[0].strip():
            names.append(prefix[0].strip())
        topics.append(prefix[-1].strip())
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
    return Organisation(
        self_names=(display,) if display else (),
        terms=unique,
        topics=tuple(t for t in topics if t),
    )


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


# The common case, cut in place: "…on refunds in my reference material." → "…on
# refunds." The model copies it from bots' decline wording; a rewrite for it cost a
# whole model call.
_SOURCE_PHRASE = re.compile(
    r"\s*,?\s*\b(?:in|from|within)\s+(?:my|the|our)\s+"
    r"(?:reference\s+materials?|references|documents|docs|knowledge\s*base|sources)\b"
    r"|\s*\b(?:meri|mere|hamari|hamare)\s+(?:reference\s+materials?|documents)\s+"
    r"(?:mein|me)\b",
    re.IGNORECASE,
)


def without_source_phrases(text: str) -> str:
    text = _SOURCE_PHRASE.sub("", text or "")
    return re.sub(r"\s+([.,;!?।])", r"\1", text)


def detail_kinds(text: str) -> List[str]:
    """The kinds of checkable detail in `text`, e.g. ``["a link", "a number"]``."""
    return [kind for kind, pattern in _DETAIL_KINDS if pattern.search(text or "")]


class Rejection(StrEnum):
    """Why the check sent a draft back to the agent (told to it as REJECTIONS).

    Stored in the run's state as its plain value, which the state requires."""

    UNCITED = "uncited"
    UNSOURCED_DETAIL = "unsourced_detail"
    EMPTY = "empty"
    SEARCH_FIRST = "search_first"
    MENTIONS_SOURCES = "mentions_sources"
    USE_FOUND = "use_found"


def rejection_feedback(
    rejection: Rejection, step: Dict[str, Any], *, searched: bool = True
) -> str:
    """What the rewrite is told: the reason, naming the kinds of unsourced detail,
    and to search first when the refused draft was written without searching."""
    feedback = REJECTIONS[rejection]
    if rejection == Rejection.UNSOURCED_DETAIL:
        kinds = detail_kinds(step.get("answer") or "")
        if kinds:
            feedback += f" It contained {' and '.join(kinds)}."
    if not searched and rejection not in (
        Rejection.EMPTY,
        Rejection.SEARCH_FIRST,
        Rejection.MENTIONS_SOURCES,
    ):
        feedback += " You haven't searched yet: search before you reply."
    return feedback


#: Why a draft was refused, as told to the agent when it rewrites it. Plain
#: guidance, never the refused text.
REJECTIONS: Dict[Rejection, str] = {
    Rejection.UNCITED: (
        "It stated something about the organisation without citing a passage. "
        "Cite the passages that support it; if none do and searches are left, "
        "search; otherwise tell the person, in your own words, that you don't have "
        "that information and where they could go instead."
    ),
    Rejection.UNSOURCED_DETAIL: (
        "It included a specific detail (a phone number, link, email or price) that "
        "no passage offered here contains word for word. Leave it out, or use it "
        "only as a passage gives it."
    ),
    Rejection.EMPTY: "It was empty. Write the reply the person should get.",
    Rejection.SEARCH_FIRST: (
        "It said it doesn't have this without searching. Search first: the answer "
        "may be in the library."
    ),
    Rejection.MENTIONS_SOURCES: (
        "It talked about its reference material, documents or passages. Say the same "
        "as someone who simply knows, or doesn't: no talk of sources."
    ),
    Rejection.USE_FOUND: (
        "A search found passages. If they answer what was asked, answer from them "
        "and cite them. If they are about something else, say plainly what you don't "
        "have and what you can help with."
    ),
}


# A reply that opens by saying it doesn't have the information is a decline, even
# when it cites a passage for where to go instead: it is what the unanswered queue
# is for.
_NO_INFORMATION = re.compile(
    r"^\W*(?:sorry\W+)?(?:i\s+)?(?:don'?t|do not|can'?t find|couldn'?t find|"
    r"have no)\s+(?:have\s+)?(?:any\s+)?(?:information|info|details|anything)"
    r"|^\W*(?:mere paas|mujhe)\b.{0,40}\b(?:jaankari|jankari)\b.{0,20}\bnahi",
    re.IGNORECASE,
)


def says_it_has_nothing(text: str) -> bool:
    first = _SENTENCE_END.split((text or "").strip(), maxsplit=1)[0]
    return bool(_NO_INFORMATION.search(first))


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
) -> Tuple[AnswerResult, Optional[Rejection]]:
    """The run's result, and the rejection reason when the
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
    citations = resolve_citations(list(step.get("citations") or []), passages)
    unsupported = False
    rejection: Optional[Rejection] = None
    # A refusal that keeps the model's text if the rewrite doesn't fix it (wording,
    # a nudge, or details removed sentence by sentence), rather than clearing it.
    keeps_text = False
    # The model chose to decline, so its text is a decline written for the person.
    # A decline forced here replaces whatever the model wrote, which may be the
    # very claim being refused; ally-be then sends the bot's decline wording.
    if (
        action == REPLY_ACTION
        and intent == AgentIntent.ANSWER
        and says_it_has_nothing(answer_text)
    ):
        logger.info("Answer opens by saying it has nothing; treating it as a decline")
        intent = AgentIntent.DECLINE
    model_declined = action == REPLY_ACTION and intent == AgentIntent.DECLINE
    about_organisation = organisation.named_in(question) or (
        turn_type == "question" and organisation.named_in(answer_text)
    )

    if action != REPLY_ACTION:
        # The tool budget ran out and the model still asked for a tool: it has
        # nothing it is willing to answer with.
        logger.info("Agent asked for a tool past its budget; declining")
        intent = AgentIntent.DECLINE
        rejection = Rejection.EMPTY
    elif not answer_text:
        intent = AgentIntent.DECLINE
        rejection = Rejection.EMPTY
    elif (
        intent == AgentIntent.ANSWER
        and not step.get("citations")
        and turn_type in ("smalltalk", "about_bot")
        and not passages
        and not looks_factual(without_contact_details(answer_text))
        and not about_organisation
    ):
        # A reply to a greeting or to "what can you do?", labelled `answer` with
        # nothing searched or cited, is small talk: the same text sent as
        # `smalltalk` would pass, so refusing it only swaps in the fixed wording.
        intent = AgentIntent.SMALLTALK
    elif intent == AgentIntent.SMALLTALK and (
        looks_factual(without_contact_details(answer_text)) or passages
    ):
        # Small talk does not need a source, but this one either states something
        # checkable (a time, a price) or was written after a search found passages:
        # ground it like an answer. Phone numbers, links and emails are checked
        # for every reply below.
        logger.info("Small talk looks factual; treating it as an answer")
        intent = AgentIntent.ANSWER
        rejection = Rejection.UNSOURCED_DETAIL
    elif intent == AgentIntent.SMALLTALK and about_organisation:
        # "What is Ally?" answered as small talk is an answer about the
        # organisation: it needs a source like any other.
        intent = AgentIntent.ANSWER
        rejection = Rejection.UNCITED

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
            rejection = rejection or Rejection.UNCITED
    elif intent != AgentIntent.DECLINE:
        rejection = None
    elif model_declined and rejection is None:
        if organisation.named_in(question) and not searched:
            # "Does Ally store audio?" → "I don't have that": it never looked.
            logger.info("Agent declined about the organisation without searching")
            rejection = Rejection.SEARCH_FIRST
        elif passages and organisation.named_in(question):
            # It searched, found passages about the organisation, and still said
            # it doesn't have it.
            logger.info("Agent declined although a search found passages")
            # A nudge: the passages may be about something else, so a decline the
            # rewrite still chooses is kept in its own words.
            rejection, keeps_text = Rejection.USE_FOUND, True

    # Fixes that keep the rest of the reply: sent back once, and if the rewrite
    # still needs them, applied to the text (sentences removed) rather than
    # refusing the reply.
    if intent != AgentIntent.DECLINE or model_declined:
        unsourced = unsupported_details(answer_text, passages)
        if unsourced and rejection in (None, Rejection.UNSOURCED_DETAIL):
            # Any reply type: a phone number, link or email must be in a passage
            # offered this run, word for word.
            logger.info("Reply carries %d unsourced contact detail(s)", len(unsourced))
            rejection, keeps_text = Rejection.UNSOURCED_DETAIL, True
            answer_text = without_details(answer_text, unsourced)
        if repeated_crisis_wording(answer_text, turn_type, history):
            # Trimmed here, not sent back: a rewrite costs a model call for what a
            # deterministic trim does. If trimming would leave nothing, the reply
            # stays as is.
            answer_text = (
                without_repeated_crisis_wording(answer_text, turn_type, history)
                or answer_text
            )
        earlier = any(turn.get("role") == "assistant" for turn in history)
        if earlier and turn_type == "smalltalk":
            # The topics were offered once; later small talk doesn't list them again.
            listed = [
                sentence
                for sentence in _SENTENCE_END.split(answer_text)
                if organisation.topics_named_in(sentence) >= 3
            ]
            if listed:
                # Trimmed here, not sent back (as above).
                answer_text = (
                    without_sentences(
                        answer_text, lambda sentence: sentence not in listed
                    )
                    or answer_text
                )
        answer_text = without_source_phrases(answer_text) or answer_text
        if rejection is None and mentions_sources(answer_text):
            # Wording, not safety: kept as written if the rewrite still does it.
            rejection, keeps_text = Rejection.MENTIONS_SOURCES, True
        if keeps_text and not answer_text:
            # Nothing left once the unsourced details were removed.
            intent, keeps_text = AgentIntent.DECLINE, False

    if intent == AgentIntent.DECLINE:
        citations = []
        if not model_declined or (rejection and not keeps_text):
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

    result = build_result(
        intent=response_intent,
        answer=answer_text,
        language=(step.get("language") or language or "en").strip(),
        confidence=0.0,
        citations=citations,
        decline_reason=decline_reason,
        retrieval=retrieval,
        meta=meta,
    )
    result["turn_type"] = turn_type
    return result, rejection
