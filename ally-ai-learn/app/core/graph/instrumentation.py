"""Graph-node instrumentation for measuring preemptive_generation behavior.

Wraps each graph node with structured log markers so we can observe:
  - How many times the graph fires per user turn (preempt re-fires)
  - Where cancellation lands within the graph
  - Which side-effecting awaits actually commit on interim transcripts

Once preemptive_generation is enabled, grep worker logs for
[GRAPH_NODE] and [GRAPH_SIDE_EFFECT] tags to characterize behaviour
before deciding whether to refactor or apply a surgical fix.
"""

import asyncio
import contextvars
import functools
import time
import uuid
from typing import Any, Awaitable, Callable, Optional

from langchain_core.runnables import RunnableConfig

from app.core.logger import logger
from app.core.metrics import turn_metrics

# Graph nodes whose successful elapsed time maps directly onto a turn-metrics
# field. Recorded from node_exit below so the breakdown is captured in one place
# (these stages have no dedicated inner timer like llm/orchestration do).
_NODE_METRIC_FIELDS = {
    "resolve_branching_instruction": "branching_ms",
    "retrieve_knowledge": "knowledge_retrieval_ms",
    # The three parallel fan-out branches — their node times let dashboards
    # answer "which branch held up the sync?" (the fan-in bottleneck).
    "process_events": "process_events_ms",
    # Under EVENTS_OFF_GATE_DEFER_DETECTION the gating node replaces process_events
    # on the critical path, so it carries the same on-gate breakdown metric.
    # (process_deferred_events runs off-gate and is intentionally not mapped here.)
    "process_gating_events": "process_events_ms",
    "detect_behaviors": "behaviors_ms",
}

# Set on first node entry of an invocation. Same value visible to nodes
# that inherit the contextvar, but LangGraph fans out parallel nodes as
# separate asyncio tasks — each gets its own copy. We also log a
# config-identity hash (cfg=) which groups parallel siblings deterministically.
_invocation_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "graph_invocation_id", default=None
)
_room_id_var: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "graph_room_id", default=None
)


def get_invocation_id() -> str:
    return _invocation_id_var.get() or "none"


def get_room_id() -> str:
    return _room_id_var.get() or "unknown"


def _config_hash(config: Optional[RunnableConfig]) -> str:
    if config is None:
        return "noconf"
    return f"{id(config) & 0xFFFFFF:06x}"


def _extract_room_id(config: Optional[RunnableConfig]) -> str:
    if not config:
        return "unknown"
    cfg = config.get("configurable") or {}
    room = cfg.get("room")
    if room is not None and hasattr(room, "name"):
        return room.name
    return cfg.get("thread_id") or "unknown"


def instrumented_node(name: str):
    """Decorator: log enter/exit/cancellation timing for a graph node."""

    def decorator(fn: Callable[..., Awaitable[dict]]):
        @functools.wraps(fn)
        async def wrapper(state, config: Optional[RunnableConfig] = None):
            inv_token = None
            room_token = None
            if _invocation_id_var.get() is None:
                inv_token = _invocation_id_var.set(uuid.uuid4().hex[:8])
                room_token = _room_id_var.set(_extract_room_id(config))

            inv_id = _invocation_id_var.get()
            room = _room_id_var.get()
            cfg_hash = _config_hash(config)
            msg_count = len(getattr(state, "messages", []) or [])
            start = time.perf_counter()

            logger.info(
                "[GRAPH_NODE] node_enter inv=%s cfg=%s room=%s node=%s msg_count=%d",
                inv_id,
                cfg_hash,
                room,
                name,
                msg_count,
            )
            try:
                result = await fn(state, config)
            except asyncio.CancelledError:
                elapsed_ms = (time.perf_counter() - start) * 1000
                logger.warning(
                    "[GRAPH_NODE] node_cancelled inv=%s cfg=%s room=%s node=%s "
                    "partial_ms=%.1f",
                    inv_id,
                    cfg_hash,
                    room,
                    name,
                    elapsed_ms,
                )
                raise
            except Exception as e:
                elapsed_ms = (time.perf_counter() - start) * 1000
                logger.exception(
                    "[GRAPH_NODE] node_error inv=%s cfg=%s room=%s node=%s "
                    "elapsed_ms=%.1f error=%s",
                    inv_id,
                    cfg_hash,
                    room,
                    name,
                    elapsed_ms,
                    str(e),
                )
                raise
            else:
                elapsed_ms = (time.perf_counter() - start) * 1000
                logger.info(
                    "[GRAPH_NODE] node_exit inv=%s cfg=%s room=%s node=%s "
                    "elapsed_ms=%.1f",
                    inv_id,
                    cfg_hash,
                    room,
                    name,
                    elapsed_ms,
                )
                metric_field = _NODE_METRIC_FIELDS.get(name)
                if metric_field is not None:
                    try:
                        turn_metrics.record(room, **{metric_field: int(elapsed_ms)})
                    except Exception:  # noqa: BLE001 - metrics never break a turn
                        logger.debug("[turn-metrics] node record failed for %s", name)
                return result
            finally:
                if inv_token is not None:
                    _invocation_id_var.reset(inv_token)
                if room_token is not None:
                    _room_id_var.reset(room_token)

        return wrapper

    return decorator


def log_side_effect(kind: str, **extra: Any) -> None:
    """Mark an irreversible external commit (SQS / UI publish / score write).

    Place this immediately BEFORE the await that commits. If cancellation
    lands after this log line for the same inv ID, the commit happened.

    kind: short identifier — "sqs_event_send", "ui_publish_score",
          "score_keeper_add_behavior", "termination_callback", etc.
    extra: contextual fields (event_id, score, count, ...).
    """
    extras = " ".join(f"{k}={v}" for k, v in extra.items())
    logger.info(
        "[GRAPH_SIDE_EFFECT] inv=%s room=%s kind=%s %s",
        get_invocation_id(),
        get_room_id(),
        kind,
        extras,
    )
