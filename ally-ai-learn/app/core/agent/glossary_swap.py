"""Runtime enforcement of the language glossary's word swaps.

The glossary tells the actor, in its prompt, to say the colloquial form of a
word instead of the literary one (``- so: say `அதனால` (avoid: `அதனால்`)``).
Canonical one-liners like that are followed well, but not always — on a mini
model the agent still used the avoid-word ~6 times per 100 messages in Tamil.
This module enforces the pairs on the agent's OUTPUT, so the word the
counsellor hears is the one the glossary asked for.

ally-be sends only pairs that are safe to swap mechanically
(``promptData.glossarySwaps``): published canonical rules whose both sides are
a single word and which are not address forms (Hindi आप→तुम would also need
the verb to change). This module trusts that list and adds the parts only the
runtime can do:

- Whole words only. A word is a maximal run of Unicode letters and combining
  marks, so an inflected form (``மாலையில்``) never matches its stem
  (``மாலை``) — the swap stays inside what the rule actually named.
- Never inside a bracketed stage direction (``[sighs]``, ``[long pause]``):
  those are TTS audio tags, not speech.
- Streaming-safe. Text arrives in chunks that can split a word; the trailing
  partial word (and an unclosed ``[``) is held back until the next chunk or
  ``flush()``. This is the partial-tail hold-back that Hermes' streaming
  think-scrubber uses for split tags — one scrubber per turn, reset between
  turns so an interrupted reply cannot leak its held text into the next.
"""

from __future__ import annotations

import unicodedata
from dataclasses import dataclass, field
from typing import Iterable, Mapping


def _is_word_char(ch: str) -> bool:
    # Letters (L*) and marks (M*): Indic vowel signs and viramas are Mn/Mc, so
    # they belong to the word they sit in.
    return unicodedata.category(ch)[0] in ("L", "M")


def _nfc(text: str) -> str:
    return unicodedata.normalize("NFC", text)


def build_swap_table(pairs: Iterable[Mapping[str, str]] | None) -> dict[str, str]:
    """``[{avoid, say}]`` -> ``{avoid: say}``, keeping only well-formed pairs.

    A pair is dropped when either side is not exactly one word, both sides are
    the same, or two pairs disagree about the same avoid-word (ambiguous rules
    are not enforced at all rather than enforced arbitrarily).
    """
    table: dict[str, str] = {}
    conflicted: set[str] = set()
    for pair in pairs or []:
        avoid = _nfc(str(pair.get("avoid") or "")).strip()
        say = _nfc(str(pair.get("say") or "")).strip()
        if not avoid or not say or avoid == say:
            continue
        if not all(_is_word_char(c) for c in avoid + say):
            continue
        key = avoid.lower()
        if key in table and table[key] != say:
            conflicted.add(key)
            continue
        table[key] = say
    for key in conflicted:
        table.pop(key, None)
    return table


@dataclass
class SwapRecord:
    avoid: str
    say: str
    count: int = 0


@dataclass
class StreamingWordSwapper:
    """Rewrite avoid-words to their colloquial form in streamed agent text."""

    table: dict[str, str]
    _buf: str = ""
    _in_tag: bool = False
    swaps: dict[str, SwapRecord] = field(default_factory=dict)

    def reset(self) -> None:
        self._buf = ""
        self._in_tag = False
        self.swaps = {}

    def feed(self, text: str) -> str:
        """Return the text that is safe to emit now; hold back the rest."""
        if not text:
            return ""
        self._buf += text
        # Hold back a trailing partial word: it may continue in the next chunk.
        cut = len(self._buf)
        while cut > 0 and _is_word_char(self._buf[cut - 1]):
            cut -= 1
        ready, self._buf = self._buf[:cut], self._buf[cut:]
        return self._rewrite(ready)

    def flush(self) -> str:
        """Emit whatever is held back (end of the reply)."""
        tail, self._buf = self._buf, ""
        return self._rewrite(tail)

    def swap_text(self, text: str) -> str:
        """Swap a complete text in one go (graph state, re-speak lines)."""
        return self.feed(text) + self.flush()

    def _rewrite(self, text: str) -> str:
        if not text or not self.table:
            # Still track tag state so a later chunk is judged correctly.
            self._track_tags(text)
            return text
        out: list[str] = []
        i, n = 0, len(text)
        while i < n:
            ch = text[i]
            if self._in_tag:
                out.append(ch)
                if ch == "]":
                    self._in_tag = False
                i += 1
                continue
            if ch == "[":
                self._in_tag = True
                out.append(ch)
                i += 1
                continue
            if not _is_word_char(ch):
                out.append(ch)
                i += 1
                continue
            j = i
            while j < n and _is_word_char(text[j]):
                j += 1
            word = text[i:j]
            say = self.table.get(_nfc(word).lower())
            if say is None:
                out.append(word)
            else:
                replacement = _match_case(word, say)
                out.append(replacement)
                rec = self.swaps.setdefault(
                    _nfc(word).lower(), SwapRecord(avoid=_nfc(word), say=say)
                )
                rec.count += 1
            i = j
        return "".join(out)

    def _track_tags(self, text: str) -> None:
        for ch in text:
            if self._in_tag and ch == "]":
                self._in_tag = False
            elif not self._in_tag and ch == "[":
                self._in_tag = True

    def swap_summary(self) -> list[dict[str, object]]:
        """Per-pair counts for turn metrics, e.g. ``[{avoid, say, count}]``."""
        return [
            {"avoid": r.avoid, "say": r.say, "count": r.count}
            for r in self.swaps.values()
        ]


def _match_case(original: str, replacement: str) -> str:
    # Only Latin script has case; keep a sentence-initial capital.
    if original[:1].isupper() and replacement[:1].islower():
        return replacement[:1].upper() + replacement[1:]
    return replacement


def swap_table_for(scenario: object) -> dict[str, str]:
    """The swap table for a scenario's session (empty when none was sent)."""
    prompt_data = getattr(scenario, "prompt_data", None)
    return build_swap_table(getattr(prompt_data, "glossary_swaps", None))


def swap_complete_text(table: dict[str, str], text: object) -> object:
    """Swap a whole reply; non-string content passes through untouched."""
    if not table or not isinstance(text, str):
        return text
    return StreamingWordSwapper(table).swap_text(text)
