"""Start, resume or read back one debrief run (thread id = run id).

- A new run id starts the graph from its inputs.
- A run id whose thread stopped part-way (the process died, or an unexpected
  error) continues from its last checkpoint: completed nodes are not run
  again, so no paid step is paid twice.
- A finished run id returns the result stored in its final checkpoint.

The graph's custom stream carries its live progress; this is the one place it
is sent on to ally-be's `progress` tool, fire-and-forget.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, Set

from langgraph.graph.state import CompiledStateGraph
from langsmith.run_helpers import tracing_context

from app.core.debrief_graph.context import DebriefRunContext
from app.core.debrief_graph.gateway import Gateway
from app.core.debrief_graph.result import build_result
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Supersteps before the loop, and per revision round (gate, reviser, checks,
#: evaluator, score); LangGraph's recursion limit is set from the recipe.
_BASE_STEPS = 20
_STEPS_PER_ROUND = 5

#: Gateway clients closing once their progress calls land (kept so they are
#: not garbage-collected mid-flight).
_closing: Set[asyncio.Task] = set()


def _recursion_limit(ctx: DebriefRunContext) -> int:
    rounds = max(
        (int(r.get("maxRevisionRounds") or 0) for r in ctx.bundle["recipes"].values()),
        default=0,
    )
    return _BASE_STEPS + _STEPS_PER_ROUND * rounds


async def _send_progress(gateway: Gateway, data: Dict[str, Any]) -> None:
    try:
        await gateway.call("progress", data)
    except Exception:  # noqa: BLE001 - the panel keeps its last line; the run goes on
        pass


async def _close_after(gateway: Gateway, pending: Set[asyncio.Task]) -> None:
    if pending:
        await asyncio.gather(*pending, return_exceptions=True)
    try:
        await gateway.aclose()
    except Exception:  # noqa: BLE001
        pass


async def run_debrief(
    graph: CompiledStateGraph, ctx: DebriefRunContext, *, resume: bool = False
) -> Dict[str, Any]:
    config = {
        "configurable": {"thread_id": ctx.run_id},
        "recursion_limit": _recursion_limit(ctx),
        "run_name": "debrief_run",
        "metadata": {"run_id": ctx.run_id},
    }
    snapshot = await graph.aget_state(config)
    if snapshot.values.get("result") and not snapshot.next:
        return snapshot.values["result"]
    started = bool(snapshot.values)
    ctx.resumed = resume or started
    # None continues the thread from its checkpoint; inputs start a new one.
    graph_input = None if started else {"steps": [], "rung": 0}

    pending: Set[asyncio.Task] = set()

    def relay(data: Dict[str, Any]) -> None:
        task = asyncio.create_task(_send_progress(ctx.gateway, data))
        pending.add(task)
        task.add_done_callback(pending.discard)

    state: Dict[str, Any] = {}
    try:
        # Never traced to LangSmith: the run carries transcripts.
        with tracing_context(enabled=False):
            async for mode, chunk in graph.astream(
                graph_input,
                config,
                context=ctx,
                stream_mode=["values", "custom"],
                durability="sync",
            ):
                if mode == "values":
                    state = chunk
                elif isinstance(chunk, dict) and chunk.get("event") == "progress":
                    relay(chunk["data"])
    except Exception as e:  # noqa: BLE001 - reported as a failed run, resumable
        logger.error(
            "debrief run %s for session %s failed: %s",
            ctx.run_id,
            ctx.session_id,
            type(e).__name__,
        )
        stopped = await graph.aget_state(config)
        return build_result(stopped.values, ctx, error=str(e) or type(e).__name__)
    finally:
        closer = asyncio.create_task(_close_after(ctx.gateway, set(pending)))
        _closing.add(closer)
        closer.add_done_callback(_closing.discard)
    return state.get("result") or build_result(state, ctx)
