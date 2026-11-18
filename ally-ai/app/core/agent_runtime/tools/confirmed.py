"""Did the person confirm the time a write would book? (chunk 6 follow-up)

Before a create or update that points at a dated record (a slot, a class, a table,
an event), or that sets a date and time itself (a site visit's time, chunk 5b §9),
the day and time must match what the person said: a time named in one of their
last four messages (two before chunk 6b), and their day if they named one
("Thursday", "tomorrow", "19 Nov"), worked out from today where the business is.
Read from the person's own messages, never from what the model says they said.

If they don't match, or the person never named a time, the write isn't sent to
ally-be: the agent is told to confirm the exact day and time first.
"""

from __future__ import annotations

import re
from datetime import date, timedelta
from typing import Any, Dict, List, Mapping, Optional, Sequence, Set, Tuple

from app.core.agent_runtime.check.offered_times import (
    _CLOCK,
    _DAY_MONTH,
    _MONTH,
    _MONTH_DAY,
    _WEEKDAY,
    _WEEKDAYS,
    _minutes,
    _month,
    record_moments,
)

# "at 4", "around 1", "by 7", "4 o'clock" with no am/pm: the hour, morning or
# afternoon. Never "for 2" (that's how many people).
_BARE_HOUR = re.compile(
    r"\b(?:at|around|about|by|@|~)\s+(1[0-2]|0?[1-9])\b"
    r"(?!\s*[:.]\d|\s*(?:a\.?\s?m|p\.?\s?m|o'?clock\s+[ap]))",
    re.IGNORECASE,
)
_OCLOCK = re.compile(
    r"\b(1[0-2]|0?[1-9])\s*o'?\s?clock\b(?!\s*[ap]\.?\s?m)", re.IGNORECASE
)
# A short yes to the assistant's last message (8a): "perfect, book it", "yes please".
_YES = re.compile(
    r"\b(?:yes|yeah|yep|yup|ya|sure|ok|okay|perfect|great|confirm(?:ed)?|"
    r"book it|go ahead|do it|please do|sounds good|that works|done|fine)\b",
    re.IGNORECASE,
)
_NOT_YES = re.compile(
    r"\b(?:no|not|don'?t|instead|but|change|another|different|other)\b|\?",
    re.IGNORECASE,
)
_NOON = re.compile(r"\b(?:noon|midday)\b", re.IGNORECASE)
_RELATIVE = re.compile(
    r"\b(day after tomorrow|tomorrow|today|tonight|this evening|this morning|"
    r"this afternoon)\b",
    re.IGNORECASE,
)
_RELATIVE_DAYS = {
    "day after tomorrow": 2,
    "tomorrow": 1,
    "today": 0,
    "tonight": 0,
    "this evening": 0,
    "this morning": 0,
    "this afternoon": 0,
}
# Today as ally-be writes it: "Saturday 14 Nov 2026, 11:58 (Asia/Kolkata, UTC+05:30)".
_TODAY = re.compile(rf"\b(\d{{1,2}})\s+{_MONTH}\s+(\d{{4}})", re.IGNORECASE)
# A date with no time, as a date field reads in a passage: "Thu 19 Nov 2026".
_RECORD_DATE = re.compile(
    rf"\b(?:mon|tue|wed|thu|fri|sat|sun)\s+(\d{{1,2}})\s+{_MONTH}\s+\d{{4}}\b",
    re.IGNORECASE,
)

Day = Tuple[int, int]  # day of month, month

# A date in numbers, day first: "21/11", "21-11-2026". Never "11.30" (a time).
_NUMERIC_DAY = re.compile(r"\b(\d{1,2})[/-](\d{1,2})(?:[/-](?:\d{4}|\d{2}))?\b")


#: How many of the person's messages a time can be confirmed in (chunk 6b): a time
#: they confirmed a few turns back ("11:00", two questions, "yes, book it") still
#: books. It was two (chunk 6).
CONFIRM_WINDOW = 4


def person_messages(
    history: Optional[Sequence[Mapping[str, Any]]], question: str
) -> List[str]:
    """The person's last CONFIRM_WINDOW messages, oldest first."""
    said = [
        str(turn.get("content") or "")
        for turn in history or []
        if turn.get("role") == "user"
    ]
    if question and (not said or said[-1].strip() != question.strip()):
        said.append(question)
    return said[-CONFIRM_WINDOW:]


def is_plain_yes(text: str) -> bool:
    """A short yes with nothing else asked or changed: "perfect, book it"."""
    words = re.findall(r"[\w']+", text)
    return 0 < len(words) <= 8 and bool(_YES.search(text)) and not _NOT_YES.search(text)


def confirmed_texts(
    history: Optional[Sequence[Mapping[str, Any]]], question: str
) -> List[str]:
    """What the person confirmed (8a): their last four messages (6b), and when the
    latest is a plain yes, the assistant's message they said yes to, if it named
    exactly one time. That message is what was sent to them, never the model's
    account of it, and one time only, so "3 or 4?" answered "yes" confirms neither."""
    said = person_messages(history, question)
    if not said or not is_plain_yes(said[-1]):
        return said
    turns = list(history or [])
    if turns and turns[-1].get("role") == "user":
        if str(turns[-1].get("content") or "").strip() == question.strip():
            turns = turns[:-1]
    if not turns or turns[-1].get("role") != "assistant":
        return said
    offered = str(turns[-1].get("content") or "")
    if len(_exact_times(offered)) != 1:
        return said
    return [*said, offered]


def _exact_times(text: str) -> Set[int]:
    """The clock times a message names exactly ("1:00 PM", "13:00"), no bare hours."""
    return {_minutes(m) for m in _CLOCK.finditer(text)}


def today_of(today: str) -> Optional[date]:
    match = _TODAY.search(today or "")
    if not match:
        return None
    return date(int(match.group(3)), _month(match.group(2)), int(match.group(1)))


#: A bare hour from 1 to 7 ("at 4", "4:30", "4.30") with no am or pm is the
#: afternoon or evening (chunk 6b): nobody books 4 in the morning. 8 to 12 stay
#: both ways.
_AFTERNOON_HOURS = range(1, 8)
# "4.30" written with a dot, no am or pm: a time only after "at", "around" and the
# like, so "2.5 km" or "Rs. 4.50" never reads as one.
_DOTTED = re.compile(
    r"\b(?:at|around|about|by|@|~)\s+(1[0-2]|0?[1-9])\.([0-5]\d)\b"
    r"(?!\s*(?:a\.?\s?m|p\.?\s?m))",
    re.IGNORECASE,
)


def _either_half(hour: int, minute: int, morning_hours: Set[int]) -> Set[int]:
    """A time of day said with no am or pm, as minutes after midnight: from 1 to 7
    the afternoon, unless only the morning time exists (`morning_hours`); 8 to 12
    either way."""
    hour %= 12
    if hour in _AFTERNOON_HOURS:
        times = {(hour + 12) * 60 + minute}
        if hour in morning_hours:
            times.add(hour * 60 + minute)
        return times
    return {hour * 60 + minute, (hour + 12) * 60 + minute}


def named_times(
    texts: Sequence[str], morning_hours: Optional[Set[int]] = None
) -> Set[int]:
    """Every time of day the person named, as minutes after midnight. With no am or
    pm, "at 4" is 16:00 (`_either_half`); "at 9" could be morning or evening, so it
    counts as both. `morning_hours` are the hours from 1 to 7 that the run's records
    have only in the morning: there "at 7" is 07:00 too."""
    morning = morning_hours or set()
    times: Set[int] = set()
    for text in texts:
        for m in _CLOCK.finditer(text):
            minutes = _minutes(m)
            ampm = m.group(3) or m.group(5)
            hour = minutes // 60
            if ampm or hour not in _AFTERNOON_HOURS or m.group(1).startswith("0"):
                # "4 pm", "16:00", "07:30" and "11:00" say which time they mean.
                times.add(minutes)
            else:
                times.update(_either_half(hour, minutes % 60, morning))
        for m in _DOTTED.finditer(text):
            times.update(_either_half(int(m.group(1)), int(m.group(2)), morning))
        for m in [*_BARE_HOUR.finditer(text), *_OCLOCK.finditer(text)]:
            times.update(_either_half(int(m.group(1)), 0, morning))
        if _NOON.search(text):
            times.add(12 * 60)
    return times


def morning_only_hours(passages: Sequence[Dict[str, Any]]) -> Set[int]:
    """The hours from 1 to 7 that the run's records have in the morning and not in
    the afternoon: "at 7" on a list whose only 7 o'clock is 07:00 means that one."""
    hours = {
        m[3] // 60 for p in passages if p.get("record_id") for m in record_moments(p)
    }
    return {h for h in _AFTERNOON_HOURS if h in hours and h + 12 not in hours}


def named_days(texts: Sequence[str], today: Optional[date]) -> Optional[Set[Day]]:
    """The days the person named, as (day, month); None when they named none. A
    weekday is the next one coming (today included); "tomorrow" and the like need
    today, and without it they can't narrow anything."""
    days: Set[Day] = set()
    named = False
    for text in texts:
        for m in _DAY_MONTH.finditer(text):
            named = True
            days.add((int(m.group(1)), _month(m.group(2))))
        for m in _MONTH_DAY.finditer(text):
            named = True
            days.add((int(m.group(2)), _month(m.group(1))))
        for m in _NUMERIC_DAY.finditer(text):
            # "21/11", "21-11-2026": day first, as dates are written in India
            # (Q3-fast Part 0b, 17 Nov C21). Not a real day and month: not a date.
            day, month = int(m.group(1)), int(m.group(2))
            if 1 <= day <= 31 and 1 <= month <= 12:
                named = True
                days.add((day, month))
        if today is None:
            continue
        for m in _WEEKDAY.finditer(text):
            named = True
            ahead = (_WEEKDAYS[m.group(1)[:3].lower()] - today.weekday()) % 7
            day = today + timedelta(days=ahead)
            days.add((day.day, day.month))
        for m in _RELATIVE.finditer(text):
            named = True
            day = today + timedelta(days=_RELATIVE_DAYS[m.group(1).lower()])
            days.add((day.day, day.month))
    return days if named else None


def _moments(passage: Dict[str, Any], dated: str) -> List[Tuple[Day, Optional[int]]]:
    if dated == "datetime":
        return [((m[1], m[2]), m[3]) for m in record_moments(passage)]
    text = " ".join(str(passage.get(key) or "") for key in ("section_path", "text"))
    return [
        ((int(m.group(1)), _month(m.group(2))), None)
        for m in _RECORD_DATE.finditer(text)
    ]


def _record(passages: Sequence[Dict[str, Any]], record_id: str) -> Optional[Dict]:
    for passage in passages:
        if str(passage.get("record_id") or "") == record_id:
            return passage
    return None


# A booking said in so many words, not asked about: "please book T1 for 2 at 11",
# "go ahead", "book karo". A question ("can I book Friday at 12?") is not one.
_BOOK_NOW = re.compile(
    r"\b(?:book|reserve|confirm|go ahead|lock (?:it|that) in|haan|haa|ji haan|"
    r"kar do|kardo|book karo|book kar do)\b",
    re.IGNORECASE,
)


def said_yes(latest: str) -> bool:
    """The person's latest message says yes to booking (Q3-fast Part 0b, 17 Nov
    F1): a plain yes, or an instruction to book that isn't a question. Choosing
    between offers ("T3 please", "the window one sounds nice") is not a yes."""
    text = latest.strip()
    if is_plain_yes(text):
        return True
    return bool(_BOOK_NOW.search(text)) and "?" not in text


def unconsented(
    properties: Mapping[str, Mapping[str, Any]],
    values: Mapping[str, Any],
    passages: Sequence[Dict[str, Any]],
    latest: str,
) -> Optional[str]:
    """Why a create that books a dated entry (a slot, a table, a class) can't go
    yet: the person hasn't said yes to it (Q3-fast Part 0b). None when they have,
    when it books nothing dated, or when their latest message isn't known."""
    if not latest.strip() or said_yes(latest):
        return None
    for key, prop in properties.items():
        value = str(values.get(key) or "").strip()
        if not (prop.get("dated") and value):
            continue
        target = _record(passages, value) if prop.get("relation") else None
        title = (
            str(
                target.get("section_path")
                or target.get("record_title")
                or target.get("document_title")
                or ""
            )
            if target
            else value
        )
        return NOT_SAID_YES.format(title=title)
    return None


#: What the agent is told when a write isn't sent (model-facing, chunk 6 follow-up).
NOT_CONFIRMED = (
    "Not done: the person hasn't confirmed this exact day and time ({title}). Ask "
    "them to confirm the day and time before you book it."
)
NOT_SAID_YES = (
    "Not done: the person picked {title} but hasn't said yes to booking it. Ask one "
    "short question with the exact booking (day, time, how many, which one), like "
    '"Shall I book {title} for you?", and book it only after they say yes.'
)
NOT_FOUND = (
    "Not done: that entry wasn't looked up in this conversation turn. Find it first, "
    "and ask the person to confirm its day and time."
)


# A date and time as the agent writes one: "2026-11-21T16:00:00+05:30". Its day and
# time are read as written: the business's own wall time, since the agent writes the
# business's offset.
_WRITTEN = re.compile(r"^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})")
_SHORT_DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
_SHORT_MONTHS = (
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
)


def _own_time_unconfirmed(
    value: str,
    messages: Sequence[str],
    today: str,
    current_moments: Sequence[Tuple[Day, Optional[int]]],
    morning_hours: Optional[Set[int]] = None,
) -> Optional[str]:
    """Why a date and time the agent wrote itself isn't what the person confirmed, or
    None. A value that isn't a date and time is left to ally-be, which refuses it."""
    match = _WRITTEN.match(value)
    if not match:
        return None
    year, month, day = (int(match.group(i)) for i in (1, 2, 3))
    try:
        written = date(year, month, day)
    except ValueError:
        return None
    minutes = int(match.group(4)) * 60 + int(match.group(5))
    moment: Tuple[Day, Optional[int]] = ((day, month), minutes)
    if moment in current_moments:
        return None  # an update that keeps the time the entry already has
    title = (
        f"{_SHORT_DAYS[written.weekday()]} {day} {_SHORT_MONTHS[month - 1]} {year}, "
        f"{minutes // 60:02d}:{minutes % 60:02d}"
    )
    times = named_times(messages, morning_hours)
    days = named_days(messages, today_of(today))
    if minutes not in times or (days is not None and (day, month) not in days):
        return NOT_CONFIRMED.format(title=title)
    return None


def unconfirmed(
    properties: Mapping[str, Mapping[str, Any]],
    values: Mapping[str, Any],
    passages: Sequence[Dict[str, Any]],
    messages: Sequence[str],
    today: str,
    *,
    updating: Optional[str] = None,
) -> Optional[str]:
    """Why this write can't go yet, or None when every dated target it sets is the
    day and time the person named. `updating` is the id of the record an update
    changes: a target it already has (shown in its passage) isn't being changed."""
    current = _record(passages, updating) if updating else None
    current_moments = _moments(current, "datetime") if current else []
    morning_hours = morning_only_hours(passages)
    for key, prop in properties.items():
        dated = prop.get("dated")
        value = str(values.get(key) or "").strip()
        if not (dated and value):
            continue
        if not prop.get("relation"):
            # A date and time the agent fills in itself (a site visit's "at", 5b §9).
            why = _own_time_unconfirmed(
                value, messages, today, current_moments, morning_hours
            )
            if why:
                return why
            continue
        target = _record(passages, value)
        if target is None:
            return NOT_FOUND
        moments = _moments(target, dated)
        title = str(target.get("section_path") or target.get("document_title") or "")
        if updating and moments and all(m in current_moments for m in moments):
            continue  # the record keeps the target it has
        times = named_times(messages, morning_hours)
        days = named_days(messages, today_of(today))
        if dated == "datetime" and not times:
            return NOT_CONFIRMED.format(title=title)
        if not any(
            (minutes is None or minutes in times) and (days is None or day in days)
            for day, minutes in moments
        ):
            return NOT_CONFIRMED.format(title=title)
    return None
