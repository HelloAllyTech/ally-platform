"""Token and cost accounting per run and per node (spec §10: log tokens and cost per
node per run), and the three per-run caps (tokens, wall clock, cost).

Usage comes from each ``AIMessage.usage_metadata``; prices from ``models.yaml``.
"""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from langchain_core.messages import AIMessage, BaseMessage

from bug_hunter.config import BugHunterConfig, ModelSpec
from bug_hunter.graph.state import Budget, NodeUsage


def usage_of(message: BaseMessage | None) -> tuple[int, int, int]:
    """``(input_tokens, cached_input_tokens, output_tokens)`` of one AI message."""
    if not isinstance(message, AIMessage) or not message.usage_metadata:
        return 0, 0, 0
    usage: dict[str, Any] = dict(message.usage_metadata)
    details = usage.get("input_token_details") or {}
    cached = int(details.get("cache_read") or 0)
    return (
        int(usage.get("input_tokens") or 0),
        cached,
        int(usage.get("output_tokens") or 0),
    )


def cost_usd(
    config: BugHunterConfig,
    spec: ModelSpec,
    input_tokens: int,
    cached: int,
    output: int,
) -> float:
    price = config.models.price_for(spec)
    fresh = max(0, input_tokens - cached)
    return (
        fresh * price.input + cached * price.cached_input + output * price.output
    ) / 1_000_000


def charge(
    config: BugHunterConfig,
    budget: Budget,
    node: str,
    spec: ModelSpec,
    message: BaseMessage | None,
    seconds: float = 0.0,
) -> Budget:
    """A new ``Budget`` with one model call added under ``node``."""
    inp, cached, out = usage_of(message)
    cost = cost_usd(config, spec, inp, cached, out)
    per_node = dict(budget.per_node)
    node_usage = per_node.get(node, NodeUsage())
    per_node[node] = NodeUsage(
        calls=node_usage.calls + 1,
        input_tokens=node_usage.input_tokens + inp,
        cached_input_tokens=node_usage.cached_input_tokens + cached,
        output_tokens=node_usage.output_tokens + out,
        cost_usd=round(node_usage.cost_usd + cost, 6),
        seconds=round(node_usage.seconds + seconds, 2),
    )
    return Budget(
        input_tokens=budget.input_tokens + inp,
        cached_input_tokens=budget.cached_input_tokens + cached,
        output_tokens=budget.output_tokens + out,
        cost_usd=round(budget.cost_usd + cost, 6),
        wall_clock_s=budget.wall_clock_s,
        per_node=per_node,
    )


def elapsed_s(started_at: str) -> float:
    if not started_at:
        return 0.0
    started = datetime.fromisoformat(started_at)
    return (datetime.now(timezone.utc) - started).total_seconds()


def with_clock(budget: Budget, started_at: str) -> Budget:
    return budget.model_copy(update={"wall_clock_s": round(elapsed_s(started_at), 1)})


def exceeded(
    config: BugHunterConfig, budget: Budget, started_at: str, app: str | None = None
) -> str | None:
    """The reason the run is over budget, or None. Checked before every model call
    and on every routing edge, so an over-budget run escalates instead of looping."""
    limits = config.limits.run
    if budget.tokens >= limits.max_tokens:
        return f"token budget exceeded ({budget.tokens} >= {limits.max_tokens})"
    if budget.cost_usd >= limits.max_cost_usd:
        cap = f"${limits.max_cost_usd:.2f}"
        return f"cost budget exceeded (${budget.cost_usd:.2f} >= {cap})"
    clock = elapsed_s(started_at) if started_at else budget.wall_clock_s
    wall_clock = limits.wall_clock_s(app)
    if clock >= wall_clock:
        return f"wall-clock budget exceeded ({clock:.0f}s >= {wall_clock}s)"
    return None
