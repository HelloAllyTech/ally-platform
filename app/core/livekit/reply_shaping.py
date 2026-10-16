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
from typing import Callable, Iterable, List, Optional

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
        # Written-out breaths, which the interim prompt's "voiced effort"
        # openings produce ("Hhh, okay…").
        "hh",
        "hhh",
        "hhhh",
        "haah",
        "phew",
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
#: The same word pattern, unanchored: ``pattern.match(buf, pos)`` never lets
#: ``^`` match at ``pos``, so walking several words needs this one.
_NEXT_WORD_RE = re.compile(r"\s*([^\s,.!?…।\[]+)([\s,.!?…।]*)")

#: Give up holding back after this many characters: a reply that has not
#: resolved its first word by then is streamed through untouched.
#: Covers the longest interim piece (delivery.MAX_PIECE_CHARS), so a reply
#: that restates one is still recognised before it is released.
_MAX_HOLD_CHARS = 64


def _phrase_words(phrase: str) -> List[str]:
    """Lower-cased words of an opener phrase, punctuation dropped."""
    return [
        w.strip("-").lower()
        for w in re.findall(r"[^\s,.!?…।\[\]]+", phrase or "")
        if w.strip("-")
    ]


def strip_leading_hesitation(text: str) -> str:
    """``text`` without a leading hesitation word, pause tag or breath.

    The one-shot form of LeadingHesitationTrimmer, for a whole line rather
    than a stream (the interim reply). The first remaining letter is
    upper-cased, since the line now starts mid-sentence.
    """
    trimmer = LeadingHesitationTrimmer(active=True)
    out = (trimmer.feed(text or "") + trimmer.flush()).strip()
    return out[:1].upper() + out[1:] if out else ""


#: Openings that claim the character understood what was said. The interim is
#: spoken before the real reply is written, so "I see…" in front of a reply
#: that refuses or pushes back makes the character contradict itself in one
#: breath. The prod prompt forbids them and gpt-4o-mini still produced
#: "I see… it's just that…" and "I get what you mean…" (2026-10-02).
_UNDERSTANDING_CLAIM = re.compile(
    r"^\s*(?:(?:okay|ok|oh|ah|yes|yeah|hmm|mm|haan)[,.…!]*\s+)?(?:"
    r"i\s+see(?:\s+what\s+you\s+mean)?"
    r"|i\s+get\s+(?:it|that|you|what\s+you(?:'|’)?re\s+saying|what\s+you\s+mean)"
    r"|i\s+(?:totally\s+|completely\s+)?understand"
    r"(?:\s+(?:that|you|what\s+you\s+mean))?"
    r"|i\s+hear\s+you"
    r"|(?:that\s+)?makes\s+sense"
    r"|that'?s\s+fair|fair\s+enough"
    r"|got\s+it"
    r"|right|okay,?\s+so|ok,?\s+so"
    r"|समझ\s+(?:गई|गया|रही\s+हूँ|रहा\s+हूँ)"
    r")(?=[\s,.!?…—–-]|$)[\s,.!?…—–-]*",
    re.IGNORECASE,
)


def strip_understanding_claim(text: str) -> str:
    """``text`` without a leading claim of understanding ("I see", "I get it",
    "that makes sense", …), then without any hesitation that follows it.

    Returns "" when nothing worth saying is left (fewer than two words), so
    the caller drops the interim rather than play a fragment.
    """
    out = _UNDERSTANDING_CLAIM.sub("", text or "", count=1)
    if out == (text or ""):
        return text or ""
    out = strip_leading_hesitation(out)
    return out if len(out.split()) >= 2 else ""


class LeadingHesitationTrimmer:
    """Remove a leading hesitation, pause tag or echoed opener from a reply.

    Two things make it lazy rather than configured up front, both learned from
    the first live run (2026-09-29):

    * **When** it is on is decided at the FIRST token, not when the stream
      opens. ``llm_node`` starts about when the turn's opener is decided, so a
      check made there could miss it; by the first token (~2 s later) the
      decision has long been recorded.
    * **What** it strips includes the opener's own words. With "I mean…" played,
      the reply opened "I mean, I try…"; with "Hmm…", "Hmm… it definitely…".
      Those phrases are passed in (``phrases``) and removed when the reply
      starts with them.
    """

    def __init__(
        self,
        active: bool = True,
        is_active: Optional[Callable[[], bool]] = None,
        phrases: Optional[Callable[[], Iterable[str]]] = None,
    ) -> None:
        self._is_active = is_active
        self._phrases_fn = phrases
        self._phrases: List[List[str]] = []
        self._decided = is_active is None
        self._buffer = ""
        self._done = not active

    def _decide(self) -> None:
        if self._decided:
            return
        self._decided = True
        try:
            if not (self._is_active and self._is_active()):
                self._done = True
                return
            self._phrases = (
                [
                    words
                    for words in (_phrase_words(p) for p in (self._phrases_fn() or []))
                    if words
                ]
                if self._phrases_fn
                else []
            )
        except Exception:  # noqa: BLE001 - a trim must never break the reply
            self._done = True

    def feed(self, text: str) -> str:
        if not self._decided and text:
            self._decide()
        if self._done:
            if self._buffer:
                out, self._buffer = self._buffer + text, ""
                return out
            return text
        self._buffer += text
        return self._drain(final=False)

    def flush(self) -> str:
        if self._done:
            out, self._buffer = self._buffer, ""
            return out
        return self._drain(final=True)

    def _leading_words(self, buf: str, count: int):
        """Up to ``count`` leading words of ``buf`` and where the last one ends.

        Returns (words, end, complete) where ``complete`` says the last word is
        followed by something, so it cannot still be growing.
        """
        words: List[str] = []
        pos = 0
        for _ in range(count):
            match = _NEXT_WORD_RE.match(buf, pos)
            if match is None:
                break
            words.append(match.group(1).strip("-").lower())
            pos = match.end()
        return words, pos, pos < len(buf)

    def _strip_phrase(self, buf: str, final: bool):
        """Strip an echoed opener phrase. Returns (new_buf, need_more)."""
        for words in self._phrases:
            got, end, complete = self._leading_words(buf, len(words))
            if got == words and (complete or final):
                return buf[end:], False
            if (
                not final
                and got == words[: len(got)]
                and (len(got) < len(words) or not complete)
            ):
                # Still a possible match; wait for more text (bounded below).
                if len(buf.strip()) <= _MAX_HOLD_CHARS:
                    return buf, True
        return buf, False

    def _drain(self, final: bool) -> str:
        while True:
            buf = self._buffer
            stripped = buf.lstrip()
            if not stripped:
                if final:
                    self._done = True
                    self._buffer = ""
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
            if self._phrases:
                new_buf, need_more = self._strip_phrase(buf, final)
                if need_more:
                    return ""
                if new_buf is not buf:
                    self._buffer = new_buf
                    continue
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
