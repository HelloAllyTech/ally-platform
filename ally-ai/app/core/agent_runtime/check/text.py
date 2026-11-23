"""Text helpers the check uses: checkable details, sentences, markdown, crisis
wording and talk about sources.
"""

from __future__ import annotations

import re
from typing import Any, Callable, Dict, List, Sequence

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


# An amount of money ("Rs. 1,600", "₹ 500", "INR 2,000.50"): a price, never a phone
# number (chunk 6b, Sunrise C4). Taken out before phone numbers are looked for.
_AMOUNT = re.compile(
    r"(?:\brs\.?|\binr\b|₹|\$|€|£)\s*\d[\d,]*(?:\.\d+)?|\b\d[\d,]*(?:\.\d+)?\s*%",
    re.IGNORECASE,
)


def contact_details(text: str) -> List[str]:
    """Phone numbers, links and emails in `text`, as written. Amounts of money and
    percentages are not phone numbers."""
    text = text or ""
    emails = _EMAIL.findall(text)
    without_emails = _EMAIL.sub(" ", text)
    links = _URL.findall(without_emails)
    without_links = _URL.sub(" ", without_emails)
    without_amounts = _AMOUNT.sub(" ", without_links)
    return [*emails, *links, *_PHONE.findall(without_amounts)]


def without_contact_details(text: str) -> str:
    """`text` with its phone numbers, links and emails blanked out."""
    for detail in contact_details(text):
        text = text.replace(detail, " ")
    return text


def unsupported_details(text: str, passages: Sequence[Dict[str, Any]]) -> List[str]:
    """Phone numbers, links and emails in `text` that no passage contains."""
    corpus = normalise_detail(" ".join(str(p.get("text") or "") for p in passages))
    return [d for d in contact_details(text) if normalise_detail(d) not in corpus]


# A sentence ends at ., ! ? or । and a space, but not after a short form that
# takes a full stop: "Rs. 500" and "Dr. Mehta" are one sentence (chunk 6b: "Rs."
# split a price from its number, and the number's half was dropped). "No." only
# before a number ("No. 5").
SENTENCE_END = re.compile(
    r"(?<=[.!?।])"
    r"(?<!\brs\.)(?<!\binr\.)(?<!\bdr\.)(?<!\bmr\.)(?<!\bmrs\.)(?<!\bms\.)"
    r"(?<!\bst\.)(?<!\bvs\.)(?<!\bapprox\.)(?<!\be\.g\.)(?<!\bi\.e\.)"
    r"(?!(?<=\bno\.)\s+\d)"
    r"\s+",
    re.IGNORECASE,
)


def without_sentences(text: str, keep: Callable[[str], bool]) -> str:
    """`text` with the sentences `keep(sentence)` rejects removed, line by line."""
    lines = []
    for line in (text or "").split("\n"):
        kept = [s for s in SENTENCE_END.split(line) if s.strip() and keep(s)]
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


# Citation leftovers in a sent reply (chunk H1 Part D): "[1]", "[2][3]", "[1, 4]",
# "Sources: [1], [2]", "(Source: [1])", "(Sources:)" and the ")" a stripped "(Source:
# [1])" leaves after a full stop. Sources show as chips beside the reply.
_SOURCE_LIST = re.compile(
    r"\(?\s*\b(?:sources?|see)\s*:\s*(?:\[\d+\](?:\s*,\s*|\s+)?)*\s*\)?\.?",
    re.IGNORECASE,
)
_MARKS = re.compile(r"\s*\[\d+(?:\s*,\s*\d+)*\](?:\s*\[\d+(?:\s*,\s*\d+)*\])*")
_EMPTY_PARENS = re.compile(r"\(\s*\)")
_STRAY_CLOSE = re.compile(r"(?<=[.!?])\)")
# Q4 C16 (the use-case suite, BHIVE's live page): citation talk the marks above
# miss. "[cite 9]", "(see source)", "(see policy)", "(citation 7)", "(entries 4,
# 5, 6)", "…listed at ₹3999.product listings cited below." and a Hindi "(देखें:".
_STRAY = [
    re.compile(r"\s*\[\s*cite[^\]]*\]", re.IGNORECASE),
    re.compile(r"\s*\(\s*see\s+(?:the\s+)?(?:sources?|policy|policies)\s*\)?", re.I),
    re.compile(
        r"\s*\(?\b(?:citations?|entries|entry)\s+\d{1,2}(?!\d)"
        r"(?:\s*(?:,|and|&|–|-)\s*\d{1,2}(?!\d))*\s*\)?",
        re.IGNORECASE,
    ),
    re.compile(
        r"(?:(?<=[.!?])|(?<=^))\s*[^.!?\n]{0,40}\bcited\s+(?:below|above|here)\b"
        r"[^.!?\n]{0,20}[.!?]?",
        re.IGNORECASE | re.MULTILINE,
    ),
    re.compile(r"\s*\(\s*देखें\s*:?\s*(?=[.)]|$)\)?"),
]


def without_citation_marks(text: str) -> str:
    """A reply as it is sent: no citation numbers or "Sources:" lists in the text."""
    text = _SOURCE_LIST.sub(
        lambda m: "" if re.search(r"\[\d|:\s*\)?\.?$", m.group(0)) else m.group(0),
        text or "",
    )
    text = _MARKS.sub("", text)
    for stray in _STRAY:
        text = stray.sub("", text)
    text = _EMPTY_PARENS.sub("", text)
    text = _STRAY_CLOSE.sub("", text)
    text = re.sub(r"[ \t]+([.,;:!?])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return re.sub(r"[ \t]+\n", "\n", text).strip()


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


# Talk about where answers come from ("my reference material", "the documents"),
# which a person shouldn't hear. Specific phrases only: "documents" alone may be a
# product feature.
_MENTIONS_SOURCES = re.compile(
    r"reference material|knowledge ?base|\bpassages?\b"
    r"|\b(?:my|the|our|these|those|provided|given|diye gaye)"
    r"\s+(?:documents|docs|sources)\b"
    # Q3-fast Part 2 (17 Nov C2): the forms that reached customers.
    r"|\bprovided\s+(?:[\w-]+\s+){0,2}"
    r"(?:materials?|information|info|content|text|details|pages?)\b"
    r"|\b(?:in|from)\s+(?:the\s+)?(?:information|info|materials?|content)"
    r"\s+(?:i|we)\s+(?:can\s+(?:see|access)|have(?:\s+access\s+to)?|was\s+given)\b"
    r"|\bin\s+(?:my|our|the)\s+"
    r"(?:materials|records|system|help\s+(?:pages|docs|documents))\b"
    r"|\bif\s+i\s+(?:don['’]?t|do\s+not)\s+know\s+the\s+answer\b",
    re.IGNORECASE,
)

# Q3-fast Part 2: the internal voice's usual opener, rewritten into a person's words
# rather than sent back. "The provided passages do not say whether X" → "I don't know
# whether X"; "The provided Scripbox materials don't describe X" → "I don't have
# information on X".
_SOURCES_NOUN = (
    r"(?:the\s+)?provided\s+(?:[\w-]+\s+){0,2}"
    r"(?:materials?|passages?|information|info|documents?|docs|sources?|content|pages?)"
)
_NOT = r"(?:do(?:es)?\s+not|do(?:es)?n['’]?t)"
_SOURCE_OPENERS = (
    (
        re.compile(
            rf"\b{_SOURCES_NOUN}\s+{_NOT}\s+(?:say|state|specify|confirm|tell\s+me)"
            r"(?=\s+(?:whether|if|what|how|when|where|which|who|why)\b)",
            re.IGNORECASE,
        ),
        "I don't know",
    ),
    (
        re.compile(
            rf"\b{_SOURCES_NOUN}\s+{_NOT}\s+(?:describe|cover|include|mention|list"
            r"|have|contain|give|say\s+anything\s+about)\b",
            re.IGNORECASE,
        ),
        "I don't have information on",
    ),
    (
        re.compile(
            r"\bif\s+i\s+(?:don['’]?t|do\s+not)\s+know\s+the\s+answer,?\s*", re.I
        ),
        "",
    ),
)


def in_a_persons_words(text: str) -> str:
    """The internal voice's openers rewritten (Q3-fast Part 2), each sentence then
    starting with a capital."""
    for pattern, words in _SOURCE_OPENERS:
        text = pattern.sub(words, text or "")
    return re.sub(
        r"(^|[.!?।]\s+)([a-z])", lambda m: m.group(1) + m.group(2).upper(), text
    ).strip()


def mentions_sources(text: str) -> bool:
    return bool(_MENTIONS_SOURCES.search(text or ""))


# The common case, cut in place: "…on refunds in my reference material." → "…on
# refunds." The model copies it from bots' decline wording; a rewrite for it cost a
# whole model call.
_SOURCE_PHRASE = re.compile(
    r"\s*,?\s*\b(?:in|from|within)\s+(?:my|the|our)\s+"
    r"(?:reference\s+materials?|references|documents|docs|knowledge\s*base|sources"
    r"|materials|records|system|help\s+(?:pages|docs|documents))\b"
    # Q3-fast Part 2: "…to Pune in the information I can see" → "…to Pune".
    r"|\s*,?\s*\b(?:in|from)\s+(?:the\s+)?(?:information|info|materials?|content)"
    r"\s+(?:i|we)\s+(?:can\s+(?:see|access)|have(?:\s+access\s+to)?)\b"
    r"|\s*\b(?:meri|mere|hamari|hamare)\s+(?:reference\s+materials?|documents)\s+"
    r"(?:mein|me)\b",
    re.IGNORECASE,
)


# Passage numbers said in words (chunk 8a): "see these details here: 1, 3, 4",
# "(source 1)", "sources 2 and 5". The numbers are the citation contract's, never
# the person's; a real count ("details: 3 sessions") is kept, since a word follows.
_PASSAGE_REF = re.compile(
    r"\s*(?:[—–-]\s*)?\(?\s*(?:see\s+)?(?:(?:these|the|those)\s+)?"
    r"(?:details|sources?|passages?|references?)(?:\s+here)?\s*:?\s*"
    r"\d{1,2}(?!\d)(?:\s*(?:,|and|&|–|-)\s*\d{1,2}(?!\d))*\s*\)?"
    r"(?!\s*[^\W\d_%₹$])(?![\d,.]\d)",
    re.IGNORECASE,
)


# A lead-in left pointing at nothing once its citation or id was cut (chunk 6b):
# "See the slot info:." or "Details here:" at the end. Short and ending in a colon
# with nothing after it, it goes whole.
_DANGLING_LEAD_IN = re.compile(
    r"(?:^|(?<=[.!?।])[ \t]+|(?<=\n))"
    r"(?:(?:please\s+)?(?:see|check|find|view|here(?:'s|\s+is|\s+are)?)\b"
    r"[^.!?:\n]{0,40}"
    r"|[^.!?:\n]{0,30}\b(?:info|information|details|below|here)\b[^.!?:\n]{0,10})"
    # ":." anywhere, or a colon with nothing after it at the end.
    r"[ \t]*:[ \t]*(?:[.!?]|(?![\s\S]*\S))",
    re.IGNORECASE | re.MULTILINE,
)


def without_source_phrases(text: str) -> str:
    text = _SOURCE_PHRASE.sub("", text or "")
    text = _PASSAGE_REF.sub("", text)
    text = _DANGLING_LEAD_IN.sub("", text)
    text = re.sub(r"[ \t]{2,}", " ", text).strip()
    return re.sub(r"\s+([.,;!?।])", r"\1", text)


#: A record id, or the start of one the model shortened ("id e596c793").
_UUID = (
    r"(?:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"
    r"|(?<=id )[0-9a-f]{6,12}\b|(?<=id: )[0-9a-f]{6,12}\b)"
)
# A list record's id as the model repeats it from a passage (chunk 6). Ids are for
# the tools, never the person. A bracket that holds one goes whole ("(slot id: …,
# appointment id: …)"); a label that starts a clause goes with its id ("Appointment
# id …;"); anywhere else only "id …" goes ("your appointment id … is booked").
_ID_IN_BRACKETS = re.compile(
    rf"\s*[(\[][^()\[\]]*{_UUID}[^()\[\]]*[)\]]", re.IGNORECASE
)
_LABELLED_ID = re.compile(
    r"(?:(?<=^)|(?<=[.;,:!?—–-]\s)|(?<=\n))"
    rf"[A-Za-z]+\s+ids?\s*(?:is\s+|:\s*|#\s*)?{_UUID}"
    rf"|\s*\bids?\b\s*(?:is\s+|:\s*|#\s*)?{_UUID}"
    rf"|\s*{_UUID}",
    re.IGNORECASE | re.MULTILINE,
)
# Talk about the records or citations themselves: "(see record)", "Citations: 1, 2",
# and passage numbers written into the text ("[1]").
_RECORD_TALK = re.compile(
    r"\s*\((?:(?:see\s+)?(?:the\s+)?(?:records?|passages?)\b[^)]*|see\s+\d[^)]*"
    r"|citations?:[^)]*)\)"
    r"|[;,.]?\s*\bsee\s+(?:records?\s*:?\s*)?\d+(?:\s*,\s*\d+)*(?=\s*[).;,!?]|\s*$)"
    r"|\s*\bcitations?:\s*\[?\d+(?:\s*,\s*\d+)*\]?\.?"
    r"|\s*\[\d+(?:\s*,\s*\d+)*\]",
    re.IGNORECASE,
)


_CITATIONS_SENTENCE = re.compile(
    r"(?:^|(?<=[.!?])[ \t]+)citations?\s*:[^\n]*?(?:[.!?](?=\s|$)|$)",
    re.IGNORECASE | re.MULTILINE,
)


def without_record_ids(text: str) -> str:
    """The reply without record ids or talk of records and citation numbers, tidied
    so no stray punctuation is left where they were."""
    text = _ID_IN_BRACKETS.sub("", text or "")
    text = _LABELLED_ID.sub("", text)
    text = _RECORD_TALK.sub("", text)
    # A sentence about its citations ("Citations: the slot details are in the records
    # I used.") goes whole.
    text = _CITATIONS_SENTENCE.sub("", text)
    text = re.sub(r"\(\s*[,;:]?\s*\)", "", text)
    text = re.sub(r"[ \t]+[—–][ \t]*(?=\()", " ", text)
    text = re.sub(r"[ \t]+[—–][ \t]*(?=[.!?,;]|$)", "", text, flags=re.MULTILINE)
    text = re.sub(r"[ \t]*[,;][ \t]*(?=[.!?]|$)", "", text, flags=re.MULTILINE)
    text = re.sub(r"([.!?])[ \t]*[,;:]+", r"\1", text)
    text = re.sub(r"(?<=[.!?])[ \t]*\.+", "", text)
    text = re.sub(r"[ \t]+([.,;!?])", r"\1", text)
    text = re.sub(r"[ \t]{2,}", " ", text)
    return "\n".join(line.rstrip() for line in text.split("\n")).strip()


def detail_kinds(text: str) -> List[str]:
    """The kinds of checkable detail in `text`, e.g. ``["a link", "a number"]``."""
    return [kind for kind, pattern in _DETAIL_KINDS if pattern.search(text or "")]


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
    first = SENTENCE_END.split((text or "").strip(), maxsplit=1)[0]
    return bool(_NO_INFORMATION.search(first))
