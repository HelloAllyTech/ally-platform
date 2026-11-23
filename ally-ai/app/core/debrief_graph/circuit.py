"""A per-model circuit breaker for the Debrief steps (port of ally-be's
`model-circuit.ts`).

When one model has failed FAILURES_TO_OPEN times within WINDOW_S, with no
success since, the breaker opens for OPEN_S: steps try their backup model
first instead of spending a learner's deadline on a provider that is down.
Per process, in memory, as before.

Kept by hand: LangGraph's RetryPolicy decides *whether* a node runs again, and
LangChain's fallbacks try a fixed list in order, but neither reorders the list
from what other runs have seen.
"""

from __future__ import annotations

import time
from typing import Dict, List, Optional

FAILURES_TO_OPEN = 5
WINDOW_S = 2 * 60
OPEN_S = 5 * 60

_failures: Dict[str, List[float]] = {}
_open_until: Dict[str, float] = {}


def record_model_failure(model: str, at: Optional[float] = None) -> None:
    at = time.time() if at is None else at
    recent = [t for t in _failures.get(model, []) if at - t < WINDOW_S]
    recent.append(at)
    _failures[model] = recent
    if len(recent) >= FAILURES_TO_OPEN:
        _open_until[model] = at + OPEN_S


def record_model_success(model: str) -> None:
    _failures.pop(model, None)
    _open_until.pop(model, None)


def is_model_circuit_open(model: str, at: Optional[float] = None) -> bool:
    at = time.time() if at is None else at
    until = _open_until.get(model)
    if until is None:
        return False
    if at >= until:
        # Half-open: the next call tries the model again.
        _open_until.pop(model, None)
        _failures.pop(model, None)
        return False
    return True


def models_to_try(
    model: Optional[str], backup: Optional[str], at: Optional[float] = None
) -> List[Optional[str]]:
    """The step's model, then its backup — the backup first while the model's
    breaker is open."""
    second = backup if backup is not None else model
    if model and backup and backup != model and is_model_circuit_open(model, at):
        return [backup, model]
    return [model, second]


def reset_model_circuits() -> None:
    """For tests."""
    _failures.clear()
    _open_until.clear()
