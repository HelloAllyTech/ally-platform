"""Turns with stable ids and times, rendered for the prompt, and split for map."""

from typing import Iterable, List, Optional

from app.core.note_harness.models import NoteTurn

# Speech runs at about 130 words a minute; used when STT gave no timings.
_WORDS_PER_MINUTE = 130


def turns_from_messages(messages: Iterable) -> List[NoteTurn]:
    """Number the diarized messages 1..n, in the order delivered.

    Accepts ChatMessage-like objects or dicts with role/content/start_time.
    Empty messages are skipped, but ids still follow the delivered order.
    """
    turns: List[NoteTurn] = []
    for msg in messages:
        get = msg.get if isinstance(msg, dict) else lambda k: getattr(msg, k, None)
        text = (get("content") or "").strip()
        if not text:
            continue
        start = get("start_time")
        turns.append(
            NoteTurn(
                id=len(turns) + 1,
                speaker=str(get("role") or "UNKNOWN").upper(),
                start=float(start) if start is not None else 0.0,
                text=text,
            )
        )
    return turns


def has_timings(turns: List[NoteTurn]) -> bool:
    return any(t.start > 0 for t in turns)


def word_count(turns: List[NoteTurn]) -> int:
    return sum(len(t.text.split()) for t in turns)


def transcript_minutes(turns: List[NoteTurn]) -> float:
    """Length of the session: from timings when STT gave them, else words."""
    if not turns:
        return 0.0
    if has_timings(turns):
        span = max(t.start for t in turns) - min(t.start for t in turns)
        # The last turn's own length isn't known; add an average turn.
        last_words = len(turns[-1].text.split())
        return (span + last_words * 60 / _WORDS_PER_MINUTE) / 60
    return word_count(turns) / _WORDS_PER_MINUTE


def format_ts(seconds: Optional[float]) -> str:
    s = int(max(0.0, seconds or 0.0))
    return f"{s // 3600:02d}:{(s % 3600) // 60:02d}:{s % 60:02d}"


def parse_ts(value: str) -> Optional[float]:
    """'HH:MM:SS' or 'MM:SS' → seconds; None when it doesn't parse."""
    try:
        parts = [int(p) for p in str(value).strip().split(":")]
    except ValueError:
        return None
    if not parts or len(parts) > 3 or any(p < 0 for p in parts):
        return None
    total = 0
    for p in parts:
        total = total * 60 + p
    return float(total)


def render_turns(turns: List[NoteTurn]) -> str:
    """One line per turn: `[id | time | SPEAKER] text`.

    Without STT timings every time would read 00:00:00, so the time is left
    out and the model orders by turn id instead.
    """
    timed = has_timings(turns)
    lines = []
    for t in turns:
        stamp = f" | {format_ts(t.start)}" if timed else ""
        lines.append(f"[{t.id}{stamp} | {t.speaker}] {t.text}")
    return "\n".join(lines)


def split_turns(turns: List[NoteTurn], max_words: int) -> List[List[NoteTurn]]:
    """Split at turn boundaries into parts of at most ~max_words, no overlap.

    A single turn longer than max_words stays whole in its own part.
    """
    parts: List[List[NoteTurn]] = []
    current: List[NoteTurn] = []
    words = 0
    for t in turns:
        n = len(t.text.split())
        if current and words + n > max_words:
            parts.append(current)
            current, words = [], 0
        current.append(t)
        words += n
    if current:
        parts.append(current)
    return parts
