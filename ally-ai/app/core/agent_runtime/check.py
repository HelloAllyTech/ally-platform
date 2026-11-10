"""Check for the conversational agent: what the model replied → what ally-be gets.

Deterministic, like v1's check. The model may chat freely, but a fact
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
from collections import Counter
from dataclasses import dataclass
from enum import StrEnum
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple

from app.core.agent_runtime.schemas import REPLY_ACTION, AgentIntent
from app.core.agent_runtime.state import BotConfig
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


def normalise_detail(detail: str) -> str:
    """A phone number, link or email as compared with passage text: lower case, no
    scheme, no trailing punctuation, no spaces or dashes."""
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
    corpus = normalise_detail(" ".join(str(p.get("text") or "") for p in passages))
    return [d for d in contact_details(text) if normalise_detail(d) not in corpus]


_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")


def without_sentences(text: str, keep: Callable[[str], bool]) -> str:
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
    if not earlier:
        return False
    if _NOT_A_CRISIS_SERVICE.search(earlier) and _NOT_A_CRISIS_SERVICE.search(text):
        return True
    return turn_type == "smalltalk" and bool(_CRISIS.search(text))


def without_repeated_crisis_wording(text: str, turn_type: str) -> str:
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
    terms: Tuple[str, ...] = ()
    #: What the bot covers, by document title ("About Ally", "Privacy and Data").
    topics: Tuple[str, ...] = ()

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


def organisation_of(bot: BotConfig) -> Organisation:
    """The organisation's names, from the bot: its display name and the name its
    documents share ("Ally FAQ – About Ally" → "Ally FAQ"), plus their distinctive
    words ("Ally"). A bot with neither has no names, and only citations apply."""
    persona = bot.get("persona") or {}
    display = (persona.get("display_name") or "").strip()
    names: List[str] = [display] if display else []
    topics: List[str] = []
    split = [
        [part.strip() for part in re.split(r"\s[–—-]\s", topic, maxsplit=1)]
        for topic in bot.get("knowledge_topics") or []
    ]
    # The name is the side the titles share: "Ally FAQ – About Ally" puts it first,
    # a crawled page's "Batch timings — Bright Minds Academy" last (chunk 20a-2).
    lefts = Counter(parts[0] for parts in split if len(parts) == 2)
    rights = Counter(parts[1] for parts in split if len(parts) == 2)
    for parts in split:
        if len(parts) != 2 or not parts[0]:
            topics.append(parts[-1])
            continue
        left, right = parts
        right_is_name = right and (
            right == display or (rights[right] >= 2 and lefts[left] < 2)
        )
        if right_is_name and left != display:
            names.append(right)
            topics.append(left)
        else:
            names.append(left)
            topics.append(right)
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

    CLINICAL_ADVICE = "clinical_advice"
    UNCITED = "uncited"
    UNSOURCED_DETAIL = "unsourced_detail"
    EMPTY = "empty"
    SEARCH_FIRST = "search_first"
    MENTIONS_SOURCES = "mentions_sources"
    USE_FOUND = "use_found"
    SEARCH_AGAIN = "search_again"
    OFFERS_SLOT = "offers_slot"


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
    Rejection.CLINICAL_ADVICE: (
        "It diagnosed, interpreted a result, or advised on a medicine or its dose. "
        "This assistant never does, whatever its instructions say. Say plainly that "
        "you can't advise on that, and point the person to the team, or to "
        "emergency care if it sounds urgent."
    ),
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
    Rejection.SEARCH_AGAIN: (
        "You said you don't have this after one search. Search once more with "
        "different words: the key words of the question, without the business's "
        "name. Then answer from the passages that answer it and cite them, or say "
        "plainly what you don't have."
    ),
    Rejection.OFFERS_SLOT: (
        "It named a day or time as available, called it a slot, or said it was "
        "booked. You can't see or hold appointments: say the team will confirm "
        "what's free, and keep the rest."
    ),
}


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


def _enforce_safety_pack(verdict: Verdict, ctx: CheckContext) -> None:
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


def _enforce_avoid_topics(verdict: Verdict, ctx: CheckContext) -> None:
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


# A reply that opens by saying it doesn't have the information is a decline, even
# when it cites a passage for where to go instead: it is what the unanswered queue
# is for.
_NO_INFORMATION = re.compile(
    r"^\W*(?:sorry\W+)?(?:i\s+)?(?:don['’]?t|do not|can['’]?t find|couldn['’]?t find|"
    r"have no)\s+(?:have\s+)?(?:any\s+)?(?:information|info|details|anything)"
    # "I don't have a refund policy": the assistant itself has none to give
    # (chunk 20a-2). "We don't have a cancellation fee" is the business's answer,
    # so this form needs "I".
    r"|^\W*(?:sorry\W+)?i\s+(?:don['’]?t|do not)\s+have\s+(?:a|an|the|any)\s+\w"
    r"|^\W*(?:mere paas|mujhe)\b.{0,40}\b(?:jaankari|jankari)\b.{0,20}\bnahi",
    re.IGNORECASE,
)


def says_it_has_nothing(text: str) -> bool:
    first = _SENTENCE_END.split((text or "").strip(), maxsplit=1)[0]
    return bool(_NO_INFORMATION.search(first))


@dataclass(frozen=True)
class CheckContext:
    """What the check knows about the run besides the draft itself."""

    passages: List[Dict[str, Any]]
    turn_type: str
    general: bool
    #: The gate verdict on the run's first search (None when it found something
    #: relevant or no search ran).
    search_gate: Optional[str]
    question: str
    #: Whether a search ran this run at all.
    searched: bool
    organisation: Organisation
    history: Sequence[Dict[str, str]]
    #: The bot's safety pack id (chunk 20a), None without one.
    safety_pack: Optional[str] = None
    #: One search ran and another is allowed (chunk 20a-2): a decline is sent back
    #: to search again with different words before it is accepted.
    can_search_again: bool = False
    #: The owner's wording for when it doesn't know (onboarding's "When it doesn't
    #: know"). Its contact details count as sourced, and every decline carries them.
    decline_text: str = ""
    #: Topics the owner asked it not to talk about (chunk 20a-2).
    avoid_topics: Sequence[str] = ()
    #: What the assistant is for (chunk 20a-2): answer, enquiries, training, guide.
    purpose: Optional[str] = None


@dataclass
class Verdict:
    """The check's decision on one draft, as it is worked out phase by phase."""

    intent: AgentIntent
    answer: str
    citations: List[Dict[str, Any]]
    #: The model chose to decline, so its text is a decline written for the person.
    #: A decline forced by the check replaces whatever the model wrote, which may be
    #: the very claim being refused; ally-be then sends the bot's decline wording.
    model_declined: bool
    rejection: Optional[Rejection] = None
    #: A refusal that keeps the model's text if the rewrite doesn't fix it (wording,
    #: a nudge, or details removed sentence by sentence), rather than clearing it.
    keeps_text: bool = False
    #: General knowledge on a bot allowed it: answered without a citation.
    unsupported: bool = False


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
    )
    verdict = _read_draft(step, ctx)
    _ground(verdict, step, ctx)
    # Safety before wording, and on every reply, declines included: the pack's rules
    # outrank everything the instructions or the model say.
    _enforce_safety_pack(verdict, ctx)
    _enforce_avoid_topics(verdict, ctx)
    # Fixes that keep the rest of the reply: sent back once, and if the rewrite
    # still needs them, applied to the text (sentences removed) rather than
    # refusing the reply.
    if verdict.intent != AgentIntent.DECLINE or verdict.model_declined:
        for fix in WORDING_FIXES:
            fix(verdict, ctx)
    _add_fallback_contact(verdict, ctx)
    result = _build_result(verdict, step, meta, ctx, language, retrieval)
    return result, verdict.rejection


# ------------------------------------------------------------------ 1. read the draft


def _read_draft(step: Dict[str, Any], ctx: CheckContext) -> Verdict:
    """The draft as plain text with its citations resolved. An answer that opens by
    saying it has nothing is the decline it is."""
    replied = (step.get("action") or REPLY_ACTION) == REPLY_ACTION
    intent = AgentIntent(step.get("intent") or AgentIntent.DECLINE)
    answer = plain_text(step.get("answer") or "")
    if replied and intent == AgentIntent.ANSWER and says_it_has_nothing(answer):
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
        verdict.intent == AgentIntent.ANSWER
        and not step.get("citations")
        and ctx.turn_type in ("smalltalk", "about_bot")
        and not ctx.passages
        and not factual
        and not about_organisation
    ):
        # A reply to a greeting or to "what can you do?", labelled `answer` with
        # nothing searched or cited, is small talk: the same text sent as
        # `smalltalk` would pass, so refusing it only swaps in the fixed wording.
        verdict.intent = AgentIntent.SMALLTALK
    elif verdict.intent == AgentIntent.SMALLTALK and (factual or ctx.passages):
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
    if verdict.intent == AgentIntent.ANSWER and not verdict.citations:
        if ctx.general and ctx.searched and not ctx.passages and not about_organisation:
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
        if names_it and not ctx.searched:
            # "Does Ally store audio?" → "I don't have that": it never looked.
            logger.info("Agent declined about the organisation without searching")
            verdict.rejection = Rejection.SEARCH_FIRST
        elif ctx.passages and names_it:
            # It searched, found passages about the organisation, and still said
            # it doesn't have it.
            logger.info("Agent declined although a search found passages")
            # A nudge: the passages may be about something else, so a decline the
            # rewrite still chooses is kept in its own words.
            verdict.rejection, verdict.keeps_text = Rejection.USE_FOUND, True
        elif ctx.can_search_again and ctx.passages and ctx.turn_type == "question":
            # One search, it found passages but not the answer, and the agent gave
            # up. On short web pages the first query often lands on a heading; a
            # second query with other words found the answer every time in the
            # 20a eval's reruns (chunk 20a-2). Kept in its own words if the rewrite
            # still declines.
            logger.info("Agent declined after one search; searching again")
            verdict.rejection, verdict.keeps_text = Rejection.SEARCH_AGAIN, True


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


def _add_fallback_contact(verdict: Verdict, ctx: CheckContext) -> None:
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
    is trimmed, not sent back; if nothing would be left, the reply stays."""
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
    for a rewrite goes out without it (and says the team will confirm)."""
    if ctx.purpose != "enquiries" or not offers_slot(verdict.answer):
        return
    kept = without_sentences(verdict.answer, lambda s: not offers_slot(s))
    verdict.answer = f"{kept} {TEAM_WILL_CONFIRM}".strip()
    if verdict.rejection is None:
        verdict.rejection, verdict.keeps_text = Rejection.OFFERS_SLOT, True


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
        for sentence in _SENTENCE_END.split(verdict.answer)
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
    _drop_unsourced_details,
    _trim_repeated_crisis_wording,
    _trim_repeated_topic_list,
    _trim_booking_offers,
    _send_back_slot_offers,
    _cut_source_phrases,
    _flag_source_talk,
    _decline_if_nothing_left,
)


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
            if ctx.search_gate and not ctx.passages
            else DeclineReason.MODEL_DECLINED
        )
    else:
        decline_reason = DeclineReason.NONE
        if verdict.intent in (AgentIntent.SMALLTALK, AgentIntent.CLARIFY):
            citations = []

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
