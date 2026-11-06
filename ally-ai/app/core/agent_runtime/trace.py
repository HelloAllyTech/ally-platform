"""One trace step per node: name, milliseconds and a one-line summary.

Summaries carry counts, scores and decisions only — never the question, passages
or answer text. They are returned to ally-be and stored in the checkpoint.
"""

from __future__ import annotations

import functools
import time
from typing import Any, Awaitable, Callable, Dict

from app.core.agent_runtime.state import AgentState

Node = Callable[[AgentState], Awaitable[Dict[str, Any]]]
Summary = Callable[[AgentState, Dict[str, Any]], str]


def traced(name: str, summary: Summary) -> Callable[[Node], Node]:
    """Wrap a node so its update also appends one trace step."""

    def decorator(node: Node) -> Node:
        @functools.wraps(node)
        async def wrapper(state: AgentState) -> Dict[str, Any]:
            started = time.monotonic()
            update = await node(state)
            ms = int((time.monotonic() - started) * 1000)
            step = {
                "node": name,
                "ms": ms,
                "summary": f"{name}: {summary(state, update)}",
            }
            return {**update, "trace": [step]}

        return wrapper

    return decorator


def summarise_run(trace: list) -> str:
    """`translate 820ms → retrieve 140ms → …`, for a log line."""
    return " → ".join(f"{step['node']} {step['ms']}ms" for step in trace)
