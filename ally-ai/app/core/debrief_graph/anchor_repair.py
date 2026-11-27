"""Point a card's quote at the turn it really came from, in code.

A card anchors a quote to a turn number. Two of ally-be's blocking checks fail
when the number is off: `wrong_speaker` (the turn is the other person's) and
`quote_mismatch` (the quote is not in that turn). Between 11-17 and 11-26 these
held seven live debriefs below the bar, and the Reviser does not always get the
time to fix them.

When the quote itself is word for word in a turn by the right speaker, only the
number is wrong, and correcting it cannot misquote anyone. Anything else is left
for the checks, the Reviser or a person: a quote that is nowhere in the
transcript (altered or made up) is never repaired, and neither is one that only
appears in the other speaker's turns.

The matching mirrors ally-be's `checkAnchor` / `normaliseForQuote`
(`debrief-cards.util.ts`): a quote may run across consecutive turns by the same
speaker (speech-to-text splits one spoken turn), never into the other speaker's.
Pure functions over the plain dicts the graph keeps in its state.
"""

from __future__ import annotations

import copy
import re
import unicodedata
from typing import Any, Dict, List, Optional, Tuple

#: A shorter quote is too easy to find by accident, so it is never re-anchored.
MIN_QUOTE_CHARS = 8

_QUOTES = str.maketrans(
    {
        "‘": "'",
        "’": "'",
        "‛": "'",
        "“": '"',
        "”": '"',
        "‟": '"',
    }
)

# Who says what, for each card kind (ally-be `checkAnchor` callers).
CLIENT = "client"
COUNSELOR = "counselor"


def normalise(text: Any) -> str:
    """ally-be's `normaliseForQuote`: NFC, plain quotes, one space between
    words, no punctuation or space at the edges, lower case."""
    s = unicodedata.normalize("NFC", str(text or ""))
    s = s.translate(_QUOTES).replace("…", "...")
    s = re.sub(r"\s+", " ", s).strip()
    # Edge characters are punctuation or space (`\p{P}`); letters and the
    # combining marks of Indic scripts must stay.
    start, end = 0, len(s)
    while start < end and _is_edge(s[start]):
        start += 1
    while end > start and _is_edge(s[end - 1]):
        end -= 1
    return s[start:end].lower()


def _is_edge(ch: str) -> bool:
    return ch.isspace() or unicodedata.category(ch).startswith("P")


def _runs(transcript: List[Dict[str, Any]]) -> Dict[int, str]:
    """For each turn, the normalised text of its run of consecutive turns by the
    same speaker."""
    by_index = {t["turn_index"]: t for t in transcript}
    out: Dict[int, str] = {}
    for index, turn in by_index.items():
        lo = hi = index
        while by_index.get(lo - 1, {}).get("role") == turn.get("role"):
            lo -= 1
        while by_index.get(hi + 1, {}).get("role") == turn.get("role"):
            hi += 1
        out[index] = normalise(
            " ".join(by_index[i].get("text") or "" for i in range(lo, hi + 1))
        )
    return out


def _is_gap(text: str) -> bool:
    t = (text or "").strip()
    return t.startswith("[") and t.endswith("]")


def _anchor_ok(
    index: Any,
    quote: str,
    speaker: str,
    by_index: Dict[int, Dict[str, Any]],
    runs: Dict[int, str],
) -> bool:
    turn = by_index.get(index) if isinstance(index, int) else None
    if not turn or _is_gap(turn.get("text") or ""):
        return False
    if turn.get("role") != speaker:
        return False
    q = normalise(quote)
    return bool(q) and q in runs[index]


def _candidates(
    quote: str,
    speaker: str,
    by_index: Dict[int, Dict[str, Any]],
    runs: Dict[int, str],
) -> List[int]:
    """Turns by `speaker` whose run contains the quote, preferring the turn
    that holds it itself (not just its run)."""
    q = normalise(quote)
    if len(q) < MIN_QUOTE_CHARS:
        return []
    own = [
        i
        for i, t in by_index.items()
        if t.get("role") == speaker
        and not _is_gap(t.get("text") or "")
        and q in normalise(t.get("text") or "")
    ]
    if own:
        return own
    return [
        i
        for i, t in by_index.items()
        if t.get("role") == speaker
        and not _is_gap(t.get("text") or "")
        and q in runs.get(i, "")
    ]


def _repair_one(
    holder: Dict[str, Any],
    speaker: str,
    by_index: Dict[int, Dict[str, Any]],
    runs: Dict[int, str],
) -> bool:
    quote = holder.get("quote")
    if not isinstance(quote, str) or not quote.strip():
        return False
    if _anchor_ok(holder.get("turn_index"), quote, speaker, by_index, runs):
        return False
    found = _candidates(quote, speaker, by_index, runs)
    # Only an unambiguous match is repaired: a phrase said twice would still pass
    # the check at the wrong turn, and the learner would be shown the wrong moment.
    if len(found) != 1:
        return False
    holder["turn_index"] = found[0]
    return True


def reanchor_quotes(
    cards: Dict[str, Any], transcript: List[Dict[str, Any]]
) -> Tuple[Dict[str, Any], int]:
    """`(cards, repaired)`: the cards with every quote whose turn number is wrong
    pointed at the turn it is really in. The input is never changed; when nothing
    needed repair the same object comes back."""
    if not transcript:
        return cards, 0
    by_index = {
        t["turn_index"]: t for t in transcript if isinstance(t.get("turn_index"), int)
    }
    runs = _runs(list(by_index.values()))
    fixed: Dict[str, Any] = copy.deepcopy(cards)
    repaired = 0

    moment = fixed.get("important_moment")
    if isinstance(moment, dict):
        repaired += _repair_one(moment, CLIENT, by_index, runs)
        for other in moment.get("others") or []:
            if isinstance(other, dict):
                repaired += _repair_one(other, CLIENT, by_index, runs)
    for key in ("what_worked", "work_on_this"):
        for card in fixed.get(key) or []:
            if isinstance(card, dict):
                repaired += _repair_one(card, COUNSELOR, by_index, runs)

    return (fixed, repaired) if repaired else (cards, 0)


def describe(repaired: int) -> Optional[str]:
    """One line for the run log, or None when nothing was repaired."""
    if not repaired:
        return None
    return (
        f"Corrected the turn number of {repaired} "
        f"quote{'s' if repaired != 1 else ''} in code."
    )
