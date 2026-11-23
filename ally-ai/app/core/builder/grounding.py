"""Grounding rules for what the builder proposes: a sample, a draft line or a
question may state only the numbers, emails and links it was given.
"""

from __future__ import annotations

import re
from typing import Tuple


def split_turn(visitor: str, assistant: str) -> Tuple[str, str]:
    """One speaker per line. A visitor line that answers its own question ("How much
    is a session? It's ₹2,000.") keeps only the question; the answer becomes the
    assistant's line when it has none. An assistant line that starts by repeating the
    question loses the repeat."""
    mark = visitor.find("?")
    if mark != -1 and visitor[mark + 1 :].strip():
        rest = visitor[mark + 1 :].strip()
        visitor = visitor[: mark + 1]
        assistant = assistant or rest
    if visitor and assistant.lower().startswith(visitor.lower()):
        assistant = assistant[len(visitor) :].strip()
    return visitor, assistant


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_LINK = re.compile(
    r"(?:https?://|www\.)[^\s,)]+|\b[\w-]+(?:\.[\w-]+)*\."
    r"(?:com|in|org|net|io|ai|co|uk|health|clinic)\b(?:/[^\s,)]*)?",
    re.IGNORECASE,
)


def sample_grounded(text: str, source: str) -> bool:
    """False when a sample states a number, email or link we were never given: the
    same rule as facts, so a card never shows the business something untrue."""
    if ungrounded(text, source):
        return False
    known = (source or "").lower()
    for found in _EMAIL.findall(text) + _LINK.findall(text):
        if found.lower().rstrip(".") not in known:
            return False
    return True


_RUN = re.compile(r"\d+")


def ungrounded(text: str, source: str) -> bool:
    """True when `text` states a number (a price, phone, time, date) that `source`
    doesn't have. Numbers are compared as digit runs, so "98200 12345" in a fact
    grounds "9820012345" in a draft; single digits and "00" are too common to judge.
    """
    runs = set(_RUN.findall(source))
    joined = "".join(_RUN.findall(source))
    for number in _RUN.findall(text):
        if len(number) < 2 or number == "00":
            continue
        if number not in runs and number not in joined:
            return True
    return False


def keep_grounded(text: str, source: str) -> str:
    """`text` without any sentence that states a number we were never given."""
    sentences = re.split(r"(?<=[.!?])\s+|\n", text or "")
    kept = [s for s in sentences if s.strip() and not ungrounded(s, source)]
    joiner = "\n" if "\n" in (text or "") else " "
    return joiner.join(kept).strip()


_DETAIL = re.compile(
    r"\d{2,}"  # a price, phone, time or size
    r"|[\w.+-]+@[\w-]+\.[\w.]+"  # an email
    r"|https?://|www\.|\b[\w-]+\.(?:com|in|org|net|io|ai|example)\b",  # a link
    re.IGNORECASE,
)


def without_details(text: str) -> str:
    """`text` without any sentence carrying a number, email or link (chunk 20a-2).

    For the assistant's instructions: facts belong in the pages it searches and
    cites. A price or phone number in the instructions makes the agent write
    details no passage holds, which the check then strips or sends back, and that
    turned answers into declines in the 20a eval."""
    sentences = re.split(r"(?<=[.!?])\s+|\n", text or "")
    kept = [s for s in sentences if s.strip() and not _DETAIL.search(s)]
    joiner = "\n" if "\n" in (text or "") else " "
    return joiner.join(kept).strip()
