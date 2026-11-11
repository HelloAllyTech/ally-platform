"""One model step as a graph node: the runner's `call()` rebuilt on LangGraph.

What ally-be's `call()` did by hand is now the node's configuration:

- "retried once, on the backup model": `RetryPolicy(max_attempts=2)`; the
  attempt number (`runtime.execution_info.node_attempt`) picks the model from
  the order the circuit breaker gave on the first attempt;
- the per-attempt HTTP timeout: the node's `timeout`, which raises
  `NodeTimeoutError` and is retried like any other failed attempt;
- "both attempts failed → null": the node's `error_handler`, which records the
  failure and routes the run as the runner did on a null answer;
- the `stepResults` checkpoint: the LangGraph checkpointer — a completed node is
  never run again on resume.

What stays here is the run view's record of each attempt (one wrapper for every
model step, so no node builds records by hand) and the breaker's bookkeeping.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

from langgraph.errors import NodeError, NodeTimeoutError
from langgraph.runtime import Runtime
from langgraph.types import Command, RetryPolicy

from app.core.debrief_graph.budget import budget_left
from app.core.debrief_graph.circuit import (
    models_to_try,
    record_model_failure,
    record_model_success,
)
from app.core.debrief_graph.constants import STEP_TIMEOUT_S
from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.records import iso, progress_event, safe_summary
from app.core.debrief_graph.state import DebriefState
from app.core.debrief_graph.step_functions import StepError

#: What a step's success or failure hook returns: extra state, and where to go
#: next (None = follow the node's static edge).
Next = Tuple[Dict[str, Any], Optional[str]]
State = DebriefState
Ctx = DebriefRunContext


class StepAttemptFailed(Exception):
    """One attempt at a model step failed; the RetryPolicy decides what next."""


@dataclass(frozen=True)
class ModelStep:
    step: str  # DebriefStep, e.g. "analyst"
    path: str  # the step's old endpoint name, e.g. "progress-reader"
    body: Callable[[State, Ctx], Dict[str, Any]]
    why: Callable[[State, Ctx], Optional[str]]
    inputs: Callable[[State, Ctx], List[str]]
    on_success: Callable[[State, Ctx, Dict[str, Any]], Next]
    on_failure: Callable[[State, Ctx], Next]
    summarise: Optional[Callable[[Dict[str, Any]], str]] = None
    reasoning: Optional[Callable[[Dict[str, Any]], Optional[str]]] = None
    round_of: Callable[[State], Optional[int]] = lambda state: None
    destinations: Tuple[str, ...] = ()

    def key(self, state: State) -> str:
        return f"{self.path}#{self.round_of(state) or 0}"


def _route(update: Dict[str, Any], nxt: Next):
    extra, goto = nxt
    merged = {**update, **extra}
    if "steps" in extra:
        merged["steps"] = update["steps"] + extra["steps"]
    return Command(update=merged, goto=goto) if goto else merged


def _reasoning(spec: ModelStep, res: Dict[str, Any]) -> Optional[str]:
    said = spec.reasoning(res) if spec.reasoning else None
    if said is not None:
        return said
    raw = res.get("reasoning")
    return raw.strip()[:2000] if isinstance(raw, str) and raw.strip() else None


def make_model_step(spec: ModelStep):
    """The node, its error handler and its policies, for `add_node`."""

    async def node(state: State, runtime: Runtime[Ctx]):
        ctx = runtime.context
        key = spec.key(state)
        rnd = spec.round_of(state)
        attempt = runtime.execution_info.node_attempt
        recipe_step = ctx.step_of(state["recipe_key"], spec.step) or {}
        scratch = ctx.attempts.get(key)
        if attempt == 1 or scratch is None:
            # A model whose breaker is open goes after its backup, not before;
            # the order is fixed for both attempts, as in the runner.
            scratch = ctx.attempts[key] = {
                "models": models_to_try(
                    recipe_step.get("model"), recipe_step.get("backupModel")
                ),
                "failed": [],
            }
            if runtime.stream_writer:
                runtime.stream_writer(
                    progress_event(spec.step, state.get("has_risk_cue", False), rnd)
                )
        model = scratch["models"][min(attempt, 2) - 1]
        est = (state.get("reserved") or {}).get(key, 0.0)
        left = budget_left(ctx.ceiling_usd, state.get("estimated", 0.0))
        base = {
            "step": spec.step,
            "label": recipe_step.get("label", ""),
        }
        t0 = ctx.clock()

        def failed(note: str) -> Dict[str, Any]:
            if model:
                record_model_failure(model)
            record = {
                **base,
                "status": "failed",
                "startedAt": iso(t0),
                "ms": round(ctx.clock() - t0),
                "model": model,
                "estimatedUsd": round(est, 4),
                **({"round": rnd} if rnd is not None else {}),
                "note": note[:300],
                "why": (
                    spec.why(state, ctx)
                    if attempt == 1
                    else "Retried once after the first attempt failed."
                ),
                "inputs": spec.inputs(state, ctx),
                "budgetLeftUsd": left,
            }
            scratch["failed"].append(record)
            return record

        try:
            res = await ctx.steps.run(
                spec.path, spec.body(state, ctx), model, ctx.session_id
            )
        except asyncio.CancelledError:
            # The node timeout cancelled this attempt (axios' wording, as before).
            ms = int(STEP_TIMEOUT_S.get(spec.path, 120.0) * 1000)
            failed(f"network: timeout of {ms}ms exceeded")
            raise
        except StepError as e:
            failed(f"{e.status if e.status is not None else 'network'}: {e.message}")
            raise StepAttemptFailed(spec.step) from e
        except Exception as e:  # noqa: BLE001 - any failed attempt is retried
            failed(f"network: {e}")
            raise StepAttemptFailed(spec.step) from e

        if model:
            record_model_success(model)
        done = {
            **base,
            "status": "done",
            "startedAt": iso(t0),
            "ms": round(ctx.clock() - t0),
            "model": res.get("model") or model,
            "estimatedUsd": round(est, 4),
            **({"round": rnd} if rnd is not None else {}),
            "note": "retried" if attempt > 1 else None,
            "why": spec.why(state, ctx),
            "inputs": spec.inputs(state, ctx),
            "reasoning": _reasoning(spec, res),
            "output": safe_summary(spec.summarise, res),
            "budgetLeftUsd": left,
        }
        ctx.attempts.pop(key, None)
        update = {"steps": scratch["failed"] + [done], "results": {key: res}}
        return _route(update, spec.on_success(state, ctx, res))

    async def on_error(state: State, error: NodeError, runtime: Runtime[Ctx]):
        if not isinstance(error.error, (StepAttemptFailed, NodeTimeoutError)):
            raise error.error  # not a step failure: the run fails, as before
        scratch = runtime.context.attempts.pop(spec.key(state), None) or {}
        update = {
            "steps": scratch.get("failed", []),
            "results": {spec.key(state): None},
        }
        return _route(update, spec.on_failure(state, runtime.context))

    return {
        "action": node,
        "error_handler": on_error,
        "retry_policy": RetryPolicy(
            max_attempts=2,
            initial_interval=0.0,
            jitter=False,
            retry_on=lambda e: isinstance(e, (StepAttemptFailed, NodeTimeoutError)),
        ),
        "timeout": STEP_TIMEOUT_S.get(spec.path, 120.0),
        "destinations": spec.destinations or None,
    }
