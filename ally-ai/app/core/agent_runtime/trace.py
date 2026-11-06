"""One trace step per node: name, milliseconds and a one-line summary.

Summaries carry counts, scores and decisions only — never the question, passages
or answer text. They are returned to ally-be and stored in the checkpoint.

Every step is also emitted as a live `step` event, and nodes announce what they
are doing as a `status` event, through LangGraph's custom stream writer. Both go
through `emit`, so a node or tool streams with no code of its own; outside a
streamed run (`/agent/run`, a direct call in a test) emitting does nothing.
"""

from __future__ import annotations

import functools
import time
from typing import Any, Awaitable, Callable, Dict, Literal, Optional

from langgraph.config import get_stream_writer

from app.core.agent_runtime.state import AgentState

Node = Callable[[AgentState], Awaitable[Dict[str, Any]]]
Summary = Callable[[AgentState, Dict[str, Any]], str]

StatusCode = Literal[
    "thinking", "searching", "found", "checking", "rewriting", "writing"
]

#: Plain-English labels for a status; clients map `code` to their own copy.
STATUS_LABELS: Dict[str, str] = {
    "thinking": "Thinking…",
    "searching": "Looking things up…",
    "found": "Found what to use",
    "checking": "Checking the answer…",
    "rewriting": "Improving the answer…",
    "writing": "Writing the reply…",
}


def emit(event: str, data: Dict[str, Any]) -> None:
    """Send one live event to whoever is streaming this run; otherwise nothing."""
    try:
        writer = get_stream_writer()
    except RuntimeError:  # not inside a graph run
        return
    writer({"event": event, "data": data})


def status_event(code: StatusCode, detail: Optional[str] = None) -> Dict[str, Any]:
    label = STATUS_LABELS[code]
    if code == "searching" and detail:
        label = f"Looking up “{detail}”…"
    elif code == "found" and detail:
        label = f"Found {detail}"
    return {"code": code, "label": label, **({"detail": detail} if detail else {})}


def status(code: StatusCode, detail: Optional[str] = None) -> None:
    """Announce what the run is doing now (a `status` event)."""
    emit("status", status_event(code, detail))


def trace_step(node: str, started: float, summary: str) -> Dict[str, Any]:
    """One trace step for a node that began at `started` (time.monotonic()).

    Also emitted as a `step` event, so every step streams the moment it exists.
    """
    ms = int((time.monotonic() - started) * 1000)
    step = {"node": node, "ms": ms, "summary": summary}
    emit("step", step)
    return step


def traced(
    name: str,
    summary: Summary,
    announce: Optional[Callable[[AgentState], StatusCode]] = None,
) -> Callable[[Node], Node]:
    """Wrap a node so its update also appends one trace step.

    `announce` names the status to emit as the node starts.
    """

    def decorator(node: Node) -> Node:
        @functools.wraps(node)
        async def wrapper(state: AgentState) -> Dict[str, Any]:
            if announce:
                status(announce(state))
            started = time.monotonic()
            update = await node(state)
            step = trace_step(name, started, f"{name}: {summary(state, update)}")
            return {**update, "trace": [step]}

        return wrapper

    return decorator


def summarise_run(trace: list) -> str:
    """`agent 820ms → tool 140ms → …`, for a log line."""
    return " → ".join(f"{step['node']} {step['ms']}ms" for step in trace)
