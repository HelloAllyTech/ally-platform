"""Speaking the fixed crisis message slowly (plan §6.3 step 4).

ally-be marks the crisis message with ``kind: "crisis"`` on its ``delta``
frame, whatever the copy — the code default or clinically approved copy per
tenant and language. The text match below is a fallback for the code-default
copy (mirrored from ally-be's ``src/guide/safety/fixed-responses.ts`` and held
to it by a test that reads that file).

Pacing is provider-agnostic: a pause between sentences, plus a slower
speaking rate on voices that expose one (Google, Ally's default).
"""

from __future__ import annotations

import re
from contextlib import contextmanager
from typing import Any, Iterator, List

from livekit import rtc

from app.core.logger import get_logger

logger = get_logger(__name__)

#: ally-be DEFAULT_CRISIS_TEXT (fixed-responses.ts). Placeholder copy until the
#: clinical reviewer approves the real text — keep byte-identical.
DEFAULT_CRISIS_TEXT = (
    "I'm really glad you told me. What you're feeling matters, and you deserve "
    "to talk to a person right now. I'm an AI, so I can't be the help you need "
    "in this moment, but someone can: please call one of the numbers below. "
    "They're free and confidential. If you are in immediate danger, call 112."
)

#: ally-be DEFAULT_CRISIS_STAY_TEXT: the line while a learner is already in
#: crisis and asked for help now.
DEFAULT_CRISIS_STAY_TEXT = (
    "You don't have to get through this alone. The numbers above are there for "
    "exactly this moment. If you can, call one now. When you're ready, you can "
    "write to me again."
)

_QUOTES = str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"'})
_WHITESPACE = re.compile(r"\s+")
# Sentence ends: Latin terminators and the Devanagari danda / double danda.
_SENTENCE_END = re.compile(r"(?<=[.!?।॥])\s+")


def _normalise(text: str) -> str:
    return _WHITESPACE.sub(" ", text.translate(_QUOTES)).strip().casefold()


_KNOWN_CRISIS_TEXTS = frozenset(
    _normalise(text) for text in (DEFAULT_CRISIS_TEXT, DEFAULT_CRISIS_STAY_TEXT)
)


def is_fixed_crisis_text(text: str) -> bool:
    """Whether ``text`` (one delta) is a fixed crisis message ally-be sends.

    Exact match after normalising quotes, case and whitespace: ally-be sends
    the whole message in one delta, and anything looser would risk slowing
    ordinary replies that merely mention help lines.
    """
    return bool(text) and _normalise(text) in _KNOWN_CRISIS_TEXTS


def split_sentences(text: str) -> List[str]:
    return [part for part in _SENTENCE_END.split(text.strip()) if part.strip()]


def silence(
    sample_rate: int, num_channels: int, seconds: float
) -> List[rtc.AudioFrame]:
    """``seconds`` of silence as 100 ms frames (small enough for any mixer)."""
    frames: List[rtc.AudioFrame] = []
    remaining = int(sample_rate * max(0.0, seconds))
    chunk = max(1, sample_rate // 10)
    while remaining > 0:
        samples = min(chunk, remaining)
        frames.append(
            rtc.AudioFrame(
                data=bytes(samples * num_channels * 2),
                sample_rate=sample_rate,
                num_channels=num_channels,
                samples_per_channel=samples,
            )
        )
        remaining -= samples
    return frames


class DeliveryState:
    """How the reply being spoken right now should sound. One per session."""

    def __init__(self) -> None:
        self.crisis = False

    def start_reply(self) -> None:
        self.crisis = False


class SpeakingRate:
    """Temporarily slows a TTS that has a speaking rate option.

    Only providers whose options carry ``speaking_rate`` (the Google plugin,
    Ally's default voice) are touched; for the rest this is a no-op and the
    sentence pauses do the pacing. A new rate applies to streams opened after
    it is set, which is why the crisis message is synthesised a sentence at a
    time inside the ``slowed`` block.
    """

    def __init__(self, tts_instance: Any) -> None:
        self._tts = tts_instance

    def _current(self) -> Any:
        options = getattr(self._tts, "_opts", None)
        return getattr(options, "speaking_rate", None)

    @contextmanager
    def slowed(self, rate: float) -> Iterator[bool]:
        previous = self._current()
        update = getattr(self._tts, "update_options", None)
        if previous is None or update is None or rate <= 0:
            yield False
            return
        try:
            update(speaking_rate=rate)
        except Exception:  # noqa: BLE001 - pacing must never cost the message
            logger.warning("[GUIDE] could not slow the voice; pausing only")
            yield False
            return
        try:
            yield True
        finally:
            try:
                update(speaking_rate=previous)
            except Exception:  # noqa: BLE001
                logger.exception("[GUIDE] could not restore the speaking rate")
