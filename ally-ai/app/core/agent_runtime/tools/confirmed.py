"""Did the person confirm the time a write would book? (chunk 6 follow-up)

Before a create or update that points at a dated record (a slot, a class, a table,
an event), or that sets a date and time itself (a site visit's time, chunk 5b §9),
the day and time must match what the person said: a time named
in their latest message or the one before, and their day if they named one
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

# "at 4", "at 11" with no am/pm: the hour, morning or afternoon.
_BARE_HOUR = re.compile(
    r"\bat\s+(1[0-2]|0?[1-9])\b(?!\s*[:.]\d|\s*(?:a\.?\s?m|p\.?\s?m|o'?clock\s+[ap]))",
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


def person_messages(
    history: Optional[Sequence[Mapping[str, Any]]], question: str
) -> List[str]:
    """The person's latest message and the one before it, oldest first."""
    said = [
        str(turn.get("content") or "")
        for turn in history or []
        if turn.get("role") == "user"
    ]
    if question and (not said or said[-1].strip() != question.strip()):
        said.append(question)
    return said[-2:]


def today_of(today: str) -> Optional[date]:
    match = _TODAY.search(today or "")
    if not match:
        return None
    return date(int(match.group(3)), _month(match.group(2)), int(match.group(1)))


def named_times(texts: Sequence[str]) -> Set[int]:
    """Every time of day the person named, as minutes after midnight. "at 4" could
    be morning or afternoon, so it counts as both."""
    times: Set[int] = set()
    for text in texts:
        times.update(_minutes(m) for m in _CLOCK.finditer(text))
        for m in _BARE_HOUR.finditer(text):
            hour = int(m.group(1)) % 12
            times.update({hour * 60, (hour + 12) * 60})
        if _NOON.search(text):
            times.add(12 * 60)
    return times


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


#: What the agent is told when a write isn't sent (model-facing, chunk 6 follow-up).
NOT_CONFIRMED = (
    "Not done: the person hasn't confirmed this exact day and time ({title}). Ask "
    "them to confirm the day and time before you book it."
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
    times = named_times(messages)
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
    for key, prop in properties.items():
        dated = prop.get("dated")
        value = str(values.get(key) or "").strip()
        if not (dated and value):
            continue
        if not prop.get("relation"):
            # A date and time the agent fills in itself (a site visit's "at", 5b §9).
            why = _own_time_unconfirmed(value, messages, today, current_moments)
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
        times = named_times(messages)
        days = named_days(messages, today_of(today))
        if dated == "datetime" and not times:
            return NOT_CONFIRMED.format(title=title)
        if not any(
            (minutes is None or minutes in times) and (days is None or day in days)
            for day, minutes in moments
        ):
            return NOT_CONFIRMED.format(title=title)
    return None
