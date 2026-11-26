"""Replies about the person themselves (chunk 8a).

A run may be given what the assistant knows about the person: their memory lines,
this chat's summary and their name. "What did I say suits me?" is answered from
those, which no passage can cite. Such a reply may go out uncited, but only when it
is plainly about them: it speaks to them, never for the organisation, every number
in it is one they gave, and it shares a word with what it was given. Anything about
the organisation still needs a source.
"""

from __future__ import annotations

import re
from typing import Set

_WORD = re.compile(r"[^\W\d_]+", re.UNICODE)
_NUMBER = re.compile(r"\d+")
#: Speaking for the organisation: then it's a claim that needs a source.
_FOR_THE_ORGANISATION = re.compile(r"\b(?:we|we're|we've|we'll|our|ours|us)\b", re.I)
_TO_THEM = re.compile(r"\b(?:you|your|you're|you've|yours)\b", re.I)
_LINK_OR_EMAIL = re.compile(r"https?://|www\.|@")
_STOP = {
    "about",
    "again",
    "also",
    "been",
    "best",
    "from",
    "have",
    "just",
    "like",
    "said",
    "that",
    "their",
    "them",
    "then",
    "there",
    "they",
    "this",
    "time",
    "told",
    "what",
    "when",
    "which",
    "with",
    "would",
    "your",
    "yours",
}


def _stems(text: str) -> Set[str]:
    return {
        w.lower()[:5]
        for w in _WORD.findall(text or "")
        if len(w) >= 4 and w.lower() not in _STOP
    }


#: TF1 round 2 (Saathi B-2): an offer of help is not a claim for the organisation, so
#: "Your name is Asha. How can we help you today?" is still about the person.
_OFFER_OF_HELP = re.compile(
    r"(?:^|(?<=[.!?]))\s*(?:how|what) can (?:i|we) (?:help|do for you)[^.!?]*[.!?]?"
    r"|(?:^|(?<=[.!?]))\s*(?:it'?s )?nice to meet you[^.!?]*[.!?]?",
    re.I,
)


def about_the_person(answer: str, personal: str) -> bool:
    """Whether `answer` only tells the person what they said about themselves."""
    if not personal.strip() or not answer.strip():
        return False
    claims = _OFFER_OF_HELP.sub(" ", answer)
    # A question back to them ("How can our listeners help?") claims nothing.
    claims = " ".join(
        s for s in re.split(r"(?<=[.!?।])\s+", claims) if not s.rstrip().endswith("?")
    )
    if _FOR_THE_ORGANISATION.search(claims) or _LINK_OR_EMAIL.search(answer):
        return False
    if not _TO_THEM.search(answer):
        return False
    given = set(_NUMBER.findall(personal))
    if any(n not in given for n in _NUMBER.findall(answer)):
        return False
    return bool(_stems(answer) & _stems(personal))


#: "I'll use it in our chats", "say 'forget my name' any time": about the name
#: itself, never a claim about the organisation.
_ABOUT_THE_NAME = re.compile(
    r"\b(?:i'?ll|i will)\s+use\s+(?:it|that|the name|your name)\b|forget my name",
    re.I,
)


def personal_part(answer: str, personal: str) -> str:
    """The sentences of `answer` that only tell the person what they told us (TF1
    round 2, B-2), with lines about using their name; "" when none do. The first
    sentence must be one of them, so an answer that leads with an uncited claim
    is never cut down to a stray clause."""
    # A clause after a dash is its own sentence here ("…is Asha — I'll use it…").
    sentences = [
        s.strip()
        for s in re.split(r"(?<=[.!?।])\s+|\s+[—–]\s+", answer or "")
        if s.strip()
    ]
    if not sentences or not about_the_person(
        _ABOUT_THE_NAME.sub("", sentences[0]) or sentences[0], personal
    ):
        return ""
    kept = [
        s
        for s in sentences
        if about_the_person(s, personal) or _ABOUT_THE_NAME.search(s)
    ]
    return " ".join(kept).strip()
