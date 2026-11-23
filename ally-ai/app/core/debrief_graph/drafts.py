"""How drafts are scored and compared: the bar, the overall and the best draft.

A draft is a plain dict (it lives in the checkpointed state):
`{cards, checks: [{code, section, detail}], weight, evaluation, round}`, where
`evaluation` is `{overall, hardFails, fixes, dimensions}` or None.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Iterable, List, Optional

from app.core.debrief_graph.constants import HARD_FAIL_CAP, QUALITY_WEIGHTS

#: Check codes that weigh ten in `checkWeight` (ally-be `debrief-cards.util.ts`).
_HEAVY_CHECKS = {"risk_cue_uncovered", "quote_mismatch", "diagnoses_trainee"}


def js_num(x: float) -> str:
    """A number as JavaScript prints it in a template string (8, not 8.0)."""
    return str(int(x)) if float(x).is_integer() else repr(float(x))


def fmt1(x: float) -> str:
    """`Number.prototype.toFixed(1)`."""
    return f"{x:.1f}"


def compute_overall(
    scores: Dict[str, Optional[float]], hard_fail_count: int
) -> Optional[float]:
    """ally-be's `computeDebriefOverall`: weighted, one decimal, capped by any
    hard fail; None unless every dimension is present."""
    total = 0.0
    for dimension, weight in QUALITY_WEIGHTS.items():
        s = scores.get(dimension)
        if s is None:
            return None
        total += s * weight
    overall = math.floor(total * 10 + 0.5) / 10  # Math.round
    return min(overall, HARD_FAIL_CAP) if hard_fail_count > 0 else overall


def check_weight(fails: Iterable[Dict[str, Any]], advisory: set) -> int:
    """`checkWeight`, for a `run_checks` answer that gives no `weight`."""
    return sum(
        0 if f["code"] in advisory else (10 if f["code"] in _HEAVY_CHECKS else 1)
        for f in fails
    )


def passes_checks(draft: Dict[str, Any], advisory: set) -> bool:
    """A draft is publishable when it passes every check."""
    return all(c["code"] in advisory for c in draft["checks"])


def meets_bar(draft: Dict[str, Any], advisory: set, pass_score: float) -> bool:
    ev = draft.get("evaluation")
    return (
        passes_checks(draft, advisory)
        and bool(ev)
        and len(ev["hardFails"]) == 0
        and (ev["overall"] or 0) >= pass_score
    )


def better_draft(
    a: Optional[Dict[str, Any]], b: Dict[str, Any], advisory: set
) -> Dict[str, Any]:
    """Better = passes the checks, then fewer weighted failures, then no hard
    fail, then higher overall. Ties keep the earlier draft."""
    if a is None:
        return b

    def key(d: Dict[str, Any]) -> List[float]:
        ev = d.get("evaluation")
        overall = ev["overall"] if ev and ev["overall"] is not None else -1
        return [
            1 if passes_checks(d, advisory) else 0,
            -d["weight"],
            0 if ev and ev["hardFails"] else 1,
            overall,
        ]

    ka, kb = key(a), key(b)
    for x, y in zip(ka, kb):
        if x != y:
            return b if y > x else a
    return a
