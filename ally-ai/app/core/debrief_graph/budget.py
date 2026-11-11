"""Reserve-then-spend cost estimates against the run's ceiling.

A port of ally-be's `estimateStepCostUsd`, priced from the request's `prices`
map instead of ally-be's pricing table. No library does this: LangChain's usage
callbacks report what a call cost after it ran, and the steps' calls go through
`generate_structured`, which already records actual usage per session for
ally-be to reconcile. The reservation is what decides whether a step may start.
"""

from __future__ import annotations

import math
from typing import Any, Dict, Optional

from app.core.debrief_graph.constants import Step

#: Expected answer size per step, in tokens: the cost estimate's output half.
OUTPUT_TOKENS: Dict[str, int] = {
    Step.SAFETY_READER: 600,
    Step.ANALYST: 3000,
    Step.PROGRESS_READER: 600,
    Step.GUIDANCE_LOOKUP: 0,
    Step.WRITER: 2500,
    Step.CHECKS: 0,
    Step.EVALUATOR: 2000,
    Step.REVISER: 2500,
}

#: Thinking models bill reasoning as output; allow for it rather than under-reserve.
THINKING_ALLOWANCE = 2


def estimate_step_cost_usd(
    step: str,
    model: Optional[str],
    input_chars: int,
    prices: Dict[str, Dict[str, Any]],
) -> float:
    """The cost a step is expected to have. Over-estimates on purpose; an
    unpriced model reserves infinity, so it never runs (plan §8.9)."""
    output = OUTPUT_TOKENS.get(step, 0)
    if not model or output == 0:
        return 0.0
    price = prices.get(model)
    if not price:
        return math.inf
    prompt_tokens = math.ceil(input_chars / 3)
    return (prompt_tokens / 1_000_000) * float(price.get("input_per_m", 0)) + (
        output * THINKING_ALLOWANCE / 1_000_000
    ) * float(price.get("output_per_m", 0))


def cost_usd(
    model: Optional[str],
    input_tokens: int,
    output_tokens: int,
    prices: Dict[str, Dict[str, Any]],
) -> float:
    """What a finished call cost, from its token usage and the request's
    prices (ally-be's `computeCostUsd`). An unpriced model costs infinity, so
    a caller holding a ceiling stops at once."""
    price = prices.get(model or "")
    if not price:
        return math.inf
    return (input_tokens / 1_000_000) * float(price.get("input_per_m", 0)) + (
        output_tokens / 1_000_000
    ) * float(price.get("output_per_m", 0))


def budget_left(ceiling: float, estimated: float) -> float:
    """What is left of the ceiling once everything reserved so far is spent."""
    return round(max(0.0, ceiling - estimated), 4)
