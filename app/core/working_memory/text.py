"""Word extraction for the working memory. One implementation, three callers.

This exists because the same six lines were written three times — in `recall`
for cue matching, in `store` for `same_fact`, in `writeout` for the groundedness
check — and all three carried the same bug, so all three were broken in the same
languages at once.

**The bug, found by the multilingual v2v sweep on 2026-08-24.** The pattern was
`[\\w']+`, and Python's `\\w` does not match Indic combining vowel signs: they
are Unicode category Mn/Mc, which is not alphanumeric. So every Devanagari,
Tamil, Kannada, Malayalam and Telugu word was SHREDDED at each matra —
"इसलिए" became "इसल" + "ए" — and the 4-character floor then deleted the
fragments. Measured on a Hindi sentence: 16 tokens, **zero** content words.

The consequences were silent and severe, and each one looked like a feature that
simply had nothing to say:

- `check_grounding` skips an item it cannot extract words from, so EVERY Indic
  disclosure vanished — not rejected as ungrounded, just gone — and
  `build_writeout` returned None. The entire semantic record was empty for every
  non-English session.
- `same_fact` compared empty sets, so reconsolidation never merged an Indic
  paraphrase and the ledger accumulated duplicates.
- Cue derivation produced nothing, so recall never responded to an Indic
  conversation, and the tier-2 fallback could not rescue it either.

This is the exact failure CLAUDE.md warns about: a fix verified in English tells
you very little about Malayalam, Tamil or Kannada.
"""

from __future__ import annotations

import re
import unicodedata
from typing import Optional, Set

#: Combining marks, discovered rather than hardcoded. Covers Devanagari matras,
#: Tamil/Kannada/Telugu/Malayalam vowel signs, Latin diacritics and the rest —
#: enumerating per-script ranges by hand is how the next script gets missed.
_MARKS = "".join(
    chr(c)
    for c in range(0x0300, 0x1E00)
    if unicodedata.category(chr(c)) in ("Mn", "Mc")
)

WORD_RE = re.compile(rf"[\w{re.escape(_MARKS)}']+", re.UNICODE)

#: Minimum length for a LATIN token to count as content-bearing. A crude
#: stopword proxy: "the", "and", "you" are short, "badminton" is not.
MIN_LATIN_LEN = 4

#: The same floor for non-Latin scripts, and it has to be lower. This is not a
#: concession — it is the same rule measured in the right unit. An abugida
#: encodes a whole syllable per codepoint, so Hindi "काम" (work) and Tamil
#: "வேலை" (work) are 3-4 codepoints where the English is 4; applying 4 to
#: Devanagari removes ordinary nouns, not function words.
#:
#: Genericness is handled language-agnostically elsewhere: the recall cue path
#: drops any token matching more than half the pool, which is what this floor
#: was only ever approximating.
MIN_OTHER_LEN = 2


def _is_latin(token: str) -> bool:
    return all(ord(ch) < 0x0250 for ch in token)


def tokens(text: Optional[str]) -> Set[str]:
    """Every word, lowercased and unfiltered. For MATCHING against cues."""
    return {w.lower() for w in WORD_RE.findall(text or "")}


def content_words(text: Optional[str]) -> Set[str]:
    """Words long enough to carry meaning. For DERIVING cues and comparing."""
    out: Set[str] = set()
    for raw in WORD_RE.findall(text or ""):
        word = raw.lower()
        floor = MIN_LATIN_LEN if _is_latin(word) else MIN_OTHER_LEN
        if len(word) >= floor:
            out.add(word)
    return out
