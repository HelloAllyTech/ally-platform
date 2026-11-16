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


def about_the_person(answer: str, personal: str) -> bool:
    """Whether `answer` only tells the person what they said about themselves."""
    if not personal.strip() or not answer.strip():
        return False
    if _FOR_THE_ORGANISATION.search(answer) or _LINK_OR_EMAIL.search(answer):
        return False
    if not _TO_THEM.search(answer):
        return False
    given = set(_NUMBER.findall(personal))
    if any(n not in given for n in _NUMBER.findall(answer)):
        return False
    return bool(_stems(answer) & _stems(personal))
