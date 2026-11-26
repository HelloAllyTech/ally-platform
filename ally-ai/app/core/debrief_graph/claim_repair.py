"""Cut an unsupported progress claim out of the draft, in code.

The Evaluator reports `unsupported_progress_claim` as a hard fail with the
offending sentence as its evidence. Fixing that is the Reviser's job, but on
live runs the graph's deadline often leaves no time for a revision (every one of
the seven such runs between 11-17 and 11-26 ended "no budget or time for another
revision"), so the claim reached the learner and the run went below the bar.

Taking the sentence out cannot add a claim, so it is safe to do without another
model call. It is deliberately narrow:

- only `unsupported_progress_claim`, and only when its evidence is found in the
  card text (anything else stays a hard fail for the Reviser or a person);
- only whole sentences, and never the last sentence of a required field: a card
  field would end up empty, so the claim is left for the Reviser instead;
- `progress_note` is optional, so a note that is only the claim is dropped.

Pure functions over the plain-dict cards the graph keeps in its state.
"""

from __future__ import annotations

import copy
import re
from typing import Any, Dict, List, Optional, Tuple

UNSUPPORTED_PROGRESS_CLAIM = "unsupported_progress_claim"

#: Evidence shorter than this is too easy to match by accident.
_MIN_EVIDENCE_CHARS = 20

# A sentence ends at . ! ? or the Devanagari danda, followed by space.
_SENTENCE_END = re.compile(r"(?<=[.!?।])\s+")


def _norm(text: str) -> str:
    """Case, whitespace, quote-mark and trailing-punctuation insensitive form."""
    t = re.sub(r"[‘’“”\"']", "", text or "")
    t = re.sub(r"\s+", " ", t).strip().lower()
    return t.rstrip(".!?। ")


def _matches(sentence: str, evidence: str) -> bool:
    s, e = _norm(sentence), _norm(evidence)
    if len(e) < _MIN_EVIDENCE_CHARS or not s:
        return False
    return e in s or (len(s) >= _MIN_EVIDENCE_CHARS and s in e)


def _strip_from(
    text: Any, evidence: List[str], allow_empty: bool
) -> Tuple[Any, List[str]]:
    """The text without sentences that match an evidence line, plus the
    evidence lines it removed. Unchanged when removal would empty a field that
    may not be empty."""
    if not isinstance(text, str) or not text.strip():
        return text, []
    sentences = _SENTENCE_END.split(text.strip())
    removed: List[str] = []
    kept: List[str] = []
    for sentence in sentences:
        hit = next((e for e in evidence if _matches(sentence, e)), None)
        if hit is None:
            kept.append(sentence)
        else:
            removed.append(hit)
    if not removed:
        return text, []
    if not kept and not allow_empty:
        return text, []
    return " ".join(kept), removed


# (path into the cards, may the field end up empty)
def _fields(cards: Dict[str, Any]) -> List[Tuple[Dict[str, Any], str, bool]]:
    out: List[Tuple[Dict[str, Any], str, bool]] = [
        (cards, "opening", False),
        (cards, "progress_note", True),
    ]
    moment = cards.get("important_moment")
    if isinstance(moment, dict):
        out += [(moment, "lead", False), (moment, "body", False)]
    for card in cards.get("what_worked") or []:
        if isinstance(card, dict):
            out += [(card, "lead", False), (card, "body", False)]
    for card in cards.get("work_on_this") or []:
        if isinstance(card, dict):
            out += [(card, "lead", False), (card, "why", False)]
    practise = cards.get("practise_next")
    if isinstance(practise, dict):
        out.append((practise, "reason", False))
    return out


def strip_unsupported_progress_claims(
    cards: Dict[str, Any], hard_fails: List[Dict[str, Any]]
) -> Tuple[Dict[str, Any], List[Dict[str, Any]], int]:
    """`(cards, hard_fails, removed)`: the cards without the sentences the
    Evaluator named as unsupported progress claims, and the hard fails with
    those no longer in them. Returns the inputs untouched when nothing could be
    removed."""
    claims = [
        h
        for h in hard_fails
        if h.get("code") == UNSUPPORTED_PROGRESS_CLAIM and h.get("evidence")
    ]
    if not claims:
        return cards, hard_fails, 0

    repaired: Dict[str, Any] = copy.deepcopy(cards)
    cleared: set = set()
    for container, key, allow_empty in _fields(repaired):
        evidence = [str(h["evidence"]) for h in claims]
        text, removed = _strip_from(container.get(key), evidence, allow_empty)
        if removed:
            container[key] = text if text else None
            cleared.update(removed)

    if not cleared:
        return cards, hard_fails, 0
    remaining = [
        h
        for h in hard_fails
        if not (
            h.get("code") == UNSUPPORTED_PROGRESS_CLAIM
            and str(h.get("evidence") or "") in cleared
        )
    ]
    return repaired, remaining, len(cleared)


def describe(removed: int, before: int) -> Optional[str]:
    """One line for the run log, or None when nothing was removed."""
    if not removed:
        return None
    return (
        f"Removed {removed} of {before} unsupported progress "
        f"claim{'s' if before != 1 else ''} in code."
    )
