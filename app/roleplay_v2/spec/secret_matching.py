"""Deterministic secret-content matching shared across the runtime.

Two independent parts of roleplay v2 need to ask the same question — *does this
piece of text disclose a locked secret?* —:

- the **rehearsal judge** (``rehearsal/judge.py``) scans CLIENT turns after the
  fact to cap ``disclosure_discipline`` when a secret leaked while locked;
- the **live Director path** (``director/service.py``) scans a Director-authored
  stage direction BEFORE it is injected into the actor's next turn card, so a
  poorly-behaved Director can never smuggle withheld content back into the
  scene, and detects when the actor has actually spoken an unlocked secret so
  the ledger can advance ``unlocked → revealed``.

Keeping the matching logic in one module means the live guard and the QA judge
can never silently drift apart.
"""

from __future__ import annotations

import re
from typing import List

# A secret fragment must be at least this long to count as a leak — short
# sentences ("I don't know.") match everything and would be false positives.
MIN_LEAK_FRAGMENT_CHARS = 25


def normalize_text(text: str) -> str:
    """Whitespace-collapsed, lower-cased form used for containment checks."""
    return re.sub(r"\s+", " ", (text or "")).strip().lower()


def leak_fragments(content: str) -> List[str]:
    """The whole secret plus each substantial sentence of it (normalized).

    A leak is a substring match of any fragment; splitting into sentences
    catches partial disclosures that don't repeat the secret verbatim.
    """
    whole = normalize_text(content)
    fragments = [whole] if whole else []
    for sentence in re.split(r"(?<=[.!?])\s+", content or ""):
        normalized = normalize_text(sentence)
        if len(normalized) >= MIN_LEAK_FRAGMENT_CHARS and normalized != whole:
            fragments.append(normalized)
    return fragments


def text_discloses_secret(text: str, secret_content: str) -> bool:
    """True when ``text`` contains the secret or a substantial sentence of it."""
    fragments = leak_fragments(secret_content)
    if not fragments:
        return False
    haystack = normalize_text(text)
    if not haystack:
        return False
    return any(fragment in haystack for fragment in fragments)
