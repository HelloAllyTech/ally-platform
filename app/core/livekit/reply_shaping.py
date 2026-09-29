"""Streaming edits to the reply's first words and its audio tags.

Two deterministic backstops on the reply stream, applied in the agent's
``llm_node`` as tokens flow to TTS:

* ``LeadingHesitationTrimmer`` — when an opener already played this turn, drop
  a leading hesitation ("um", "well", "hmm", "अं") or pause/sigh tag from the
  reply. The reply prompt is told what was already said (``TurnDelivery``); this
  catches the turns where the model opens with one anyway. In prod, 19 of 43
  sampled filler turns were a double hesitation.
* ``AudioTagLimiter`` — cap inline ElevenLabs v3 tags per reply. Before
  2026-09-25, 41% of v3 replies carried two or more tags ([pause] and [sighs]
  dominating), which reads as performative. Enforced in code because the tag
  guidance prompt is dashboard-editable and a prompt edit is advice, not a cap.

Both hold back only as much text as they must to decide, so first audio is
delayed by at most one short word.
"""

from __future__ import annotations

import re
from typing import Optional

#: Leading words that are pure hesitation — removing them never changes what
#: the character says. Acknowledgements ("okay", "right") are NOT here: they can
#: carry meaning ("Right, I'll try that").
_HESITATION_WORDS = frozenset(
    {
        "um",
        "umm",
        "ummm",
        "uh",
        "uhh",
        "uhm",
        "er",
        "erm",
        "hmm",
        "hmmm",
        "hm",
        "mm",
        "mmm",
        "mhm",
        "well",
        "उम्म",
        "अं",
        "हम्म",
        "अम्म",
        "म्म",
        "हम्म्",
    }
)

#: Tags that are a pause or a body sound — the second pause after an opener.
_PAUSE_TAGS = frozenset(
    {
        "pause",
        "short pause",
        "long pause",
        "sighs",
        "sigh",
        "heavy sigh",
        "breathes",
        "inhales",
        "exhales",
        "clears throat",
        "hesitates",
    }
)

_TAG_RE = re.compile(r"^\s*\[([^\]]{1,40})\]\s*")
_WORD_RE = re.compile(r"^\s*([^\s,.!?…।\[]+)([\s,.!?…।]*)")

#: Give up holding back after this many characters: a reply that has not
#: resolved its first word by then is streamed through untouched.
_MAX_HOLD_CHARS = 48


class LeadingHesitationTrimmer:
    """Remove leading hesitation words / pause tags from a streamed reply."""

    def __init__(self, active: bool) -> None:
        self._active = active
        self._buffer = ""
        self._done = not active

    def feed(self, text: str) -> str:
        if self._done:
            return text
        self._buffer += text
        return self._drain(final=False)

    def flush(self) -> str:
        if self._done:
            return ""
        return self._drain(final=True)

    def _drain(self, final: bool) -> str:
        while True:
            buf = self._buffer
            stripped = buf.lstrip()
            if not stripped:
                if final:
                    self._done = True
                    self._buffer = ""
                    return ""
                return ""
            if stripped.startswith("["):
                match = _TAG_RE.match(buf)
                if match is None:
                    if "]" in stripped or len(stripped) > _MAX_HOLD_CHARS or final:
                        return self._release()
                    return ""
                tag = match.group(1).strip().lower()
                if tag in _PAUSE_TAGS:
                    self._buffer = buf[match.end() :]
                    continue
                return self._release()
            match = _WORD_RE.match(buf)
            # A word is only decidable once something follows it.
            if match is None or (match.end() == len(buf) and not final):
                if len(stripped) > _MAX_HOLD_CHARS or final:
                    return self._release()
                return ""
            word = match.group(1).strip("-").lower()
            if word in _HESITATION_WORDS:
                self._buffer = buf[match.end() :]
                continue
            return self._release()

    def _release(self) -> str:
        self._done = True
        out = self._buffer.lstrip()
        self._buffer = ""
        # Re-capitalise a Latin first letter left lower-case by the trim.
        if out and out[0].isalpha() and out[0].islower() and out[0].isascii():
            out = out[0].upper() + out[1:]
        return out


class AudioTagLimiter:
    """Keep at most ``max_tags`` inline ``[tag]``s in a streamed reply.

    Holds back text only while inside a possible tag (after ``[``), so ordinary
    text streams through unchanged. A bracket that never closes within a short
    span is released as text — it was not a tag.
    """

    def __init__(self, max_tags: Optional[int]) -> None:
        self._max = max_tags
        self._kept = 0
        self._pending = ""

    @property
    def active(self) -> bool:
        return self._max is not None and self._max >= 0

    def feed(self, text: str) -> str:
        if not self.active:
            return text
        out = []
        for ch in text:
            if self._pending:
                self._pending += ch
                if ch == "]":
                    out.append(self._resolve())
                elif len(self._pending) > 42 or ch == "\n":
                    out.append(self._pending)
                    self._pending = ""
            elif ch == "[":
                self._pending = ch
            else:
                out.append(ch)
        return "".join(out)

    def flush(self) -> str:
        pending, self._pending = self._pending, ""
        return pending

    def _resolve(self) -> str:
        tag, self._pending = self._pending, ""
        if self._kept < (self._max or 0):
            self._kept += 1
            return tag
        return ""
