"""The times a reply offers, grounded in the run's list records (chunk 6).

An assistant that can book may say a time is free only when a find (or a write) in
this run returned it. Each sentence or list item that offers a clock time ("1)
Mon 16 Nov 10:00", "11:00 is free", "I can book you at 4 pm") is matched against the
record passages of the run, by time of day and, where the sentence names one, by
day: a match is cited, and a time that no record backs is not grounded.

Opening hours ("we're open 9:00 to 18:00") are a range, not an offer, and are left
alone, as is any sentence that names a time without offering it.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Sequence, Set, Tuple

from app.core.agent_runtime.check.text import SENTENCE_END

_AMPM = r"(a\.?\s?m\.?|p\.?\s?m\.?)"
_CLOCK = re.compile(
    rf"(?<![\d:])(?:([01]?\d|2[0-3]):([0-5]\d)\s*{_AMPM}?|(1[0-2]|0?[1-9])\s*{_AMPM})"
    r"(?![\w:])",
    re.IGNORECASE,
)
_RANGE = re.compile(
    rf"(?:\d{{1,2}}(?::\d{{2}})?\s*{_AMPM}?)\s*(?:-|–|—|to|until|till)\s*"
    rf"(?:\d{{1,2}}(?::\d{{2}})?\s*{_AMPM}?)",
    re.IGNORECASE,
)
_WEEKDAYS = {
    "mon": 0,
    "tue": 1,
    "wed": 2,
    "thu": 3,
    "fri": 4,
    "sat": 5,
    "sun": 6,
}
_WEEKDAY = re.compile(
    r"\b(monday|mon|tuesday|tues|tue|wednesday|wed|thursday|thurs|thu|friday|fri|"
    r"saturday|sat|sunday|sun)\b\.?",
    re.IGNORECASE,
)
_MONTHS = ("jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov")
_MONTHS += ("dec",)
_MONTH = r"(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?"
_DAY_MONTH = re.compile(rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+{_MONTH}", re.IGNORECASE)
_MONTH_DAY = re.compile(rf"\b{_MONTH}\s+(\d{{1,2}})(?:st|nd|rd|th)?\b", re.IGNORECASE)
_OFFER = re.compile(
    r"\b(?:free|available|availability|open\s+(?:slots?|times?)|book|booked|booking|"
    r"slots?|alternatives?|instead|options?|appointments?|reserve|reserved|times?)\b",
    re.IGNORECASE,
)
_LIST_ITEM = re.compile(r"^\s*(?:[-•*·]|\d{1,2}[.)])\s+")
# How a list record's date-time reads in its passage: "Thu 19 Nov 2026, 11:15".
_RECORD_MOMENT = re.compile(
    rf"\b(mon|tue|wed|thu|fri|sat|sun)\s+(\d{{1,2}})\s+{_MONTH}\s+\d{{4}},\s+"
    r"(\d{2}):(\d{2})\b",
    re.IGNORECASE,
)

Moment = Tuple[int, int, int, int]  # weekday, day, month (1-12), minutes


def _month(name: str) -> int:
    return _MONTHS.index(name[:3].lower()) + 1


def _minutes(match: re.Match) -> int:
    if match.group(1) is not None:
        hour, minute, ampm = int(match.group(1)), int(match.group(2)), match.group(3)
    else:
        hour, minute, ampm = int(match.group(4)), 0, match.group(5)
    if ampm:
        pm = ampm.lower().startswith("p")
        hour = hour % 12 + (12 if pm else 0)
    return hour * 60 + minute


def offered_times(unit: str) -> List[int]:
    """The clock times a sentence offers, as minutes after midnight; none for a
    sentence that offers nothing or gives a range (opening hours)."""
    if _RANGE.search(unit):
        return []
    if not (_OFFER.search(unit) or _LIST_ITEM.match(unit)):
        return []
    return [_minutes(m) for m in _CLOCK.finditer(unit)]


def _days(unit: str) -> Tuple[Set[int], Set[Tuple[int, int]]]:
    weekdays = {_WEEKDAYS[m.group(1)[:3].lower()] for m in _WEEKDAY.finditer(unit)}
    dates = {(int(m.group(1)), _month(m.group(2))) for m in _DAY_MONTH.finditer(unit)}
    dates |= {(int(m.group(2)), _month(m.group(1))) for m in _MONTH_DAY.finditer(unit)}
    return weekdays, dates


def record_moments(passage: Dict[str, Any]) -> List[Moment]:
    """The date-times a record passage shows: its title and its fields."""
    text = " ".join(
        str(passage.get(key) or "")
        for key in ("section_path", "document_title", "text")
    )
    return [
        (
            _WEEKDAYS[m.group(1)[:3].lower()],
            int(m.group(2)),
            _month(m.group(3)),
            int(m.group(4)) * 60 + int(m.group(5)),
        )
        for m in _RECORD_MOMENT.finditer(text)
    ]


def units(answer: str) -> List[str]:
    """The reply's sentences, line by line: a list item is its own unit."""
    return [
        sentence.strip()
        for line in (answer or "").split("\n")
        for sentence in SENTENCE_END.split(line)
        if sentence.strip()
    ]


def ground_offered_times(
    answer: str, passages: Sequence[Dict[str, Any]]
) -> Tuple[List[int], List[str]]:
    """The passage numbers (1-based) of the records that back the times the reply
    offers, and the sentences offering a time no record of this run backs."""
    records = [
        (number, record_moments(passage))
        for number, passage in enumerate(passages, start=1)
        if passage.get("record_id")
    ]
    backing: List[int] = []
    unfounded: List[str] = []
    # A day named once ("On Thursday 19 Nov:") holds for the items after it.
    context: Tuple[Set[int], Set[Tuple[int, int]]] = (set(), set())
    for unit in units(answer):
        weekdays, dates = _days(unit)
        if weekdays or dates:
            context = (weekdays, dates)
        else:
            weekdays, dates = context
        times = offered_times(unit)
        if not times:
            continue
        grounded = True
        for minutes in times:
            found = [
                number
                for number, moments in records
                if any(
                    moment[3] == minutes
                    and (not weekdays or moment[0] in weekdays)
                    and (not dates or (moment[1], moment[2]) in dates)
                    for moment in moments
                )
            ]
            if not found:
                grounded = False
                continue
            backing.extend(n for n in found if n not in backing)
        if not grounded:
            unfounded.append(unit)
    return backing, unfounded
