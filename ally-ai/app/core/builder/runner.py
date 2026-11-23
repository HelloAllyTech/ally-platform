"""One builder step for both endpoints: `/builder/step` waits for the response, and
`/builder/step/stream` sends the same step's `status` events, then the message as
`token` events, then `final`. Both call `execute`, so the two can't drift.

The message's tokens are cut only after the step has ended, as in 3c: what streams
is exactly what `final` carries. The SSE framing, heartbeat and cancel-on-disconnect
are the agent runtime's.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Dict, Optional, Tuple

from langsmith.run_helpers import tracing_context

from app.core.agent_runtime.runner import (
    HEARTBEAT_SECONDS,
    chunk_reply,
    error_code,
    sse,
)
from app.core.builder.flow import STATUS_LABELS, OnEvent, run_step
from app.core.config import settings
from app.schemas.builder import BuilderStepRequest, BuilderStepResponse
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def execute(
    payload: BuilderStepRequest, on_event: Optional[OnEvent] = None
) -> BuilderStepResponse:
    """Run one step inside the hard cap (STEP_TIMEOUT_SECONDS); TimeoutError past it.

    Tracing stays off: the owner's words and their site's content never leave for
    LangSmith.
    """
    budget = settings.BUILDER.STEP_TIMEOUT_SECONDS
    with tracing_context(enabled=False):
        async with asyncio.timeout(budget):
            response = await run_step(payload, on_event, budget=budget)
    if on_event and response.message:
        on_event("status", {"code": "writing", "label": STATUS_LABELS["writing"]})
        for piece in chunk_reply(response.message):
            on_event("token", {"text": piece})
    return response


async def stream(payload: BuilderStepRequest) -> AsyncIterator[str]:
    """The step as Server-Sent Events: status…, token…, then `final` (exactly
    `/builder/step`'s body) or `error {code}`. Closing the generator cancels it."""
    queue: asyncio.Queue[Optional[Tuple[str, Dict[str, Any]]]] = asyncio.Queue()

    def on_event(event: str, data: Dict[str, Any]) -> None:
        queue.put_nowait((event, data))

    async def work() -> None:
        try:
            response = await execute(payload, on_event)
            on_event("final", response.model_dump(mode="json"))
        except Exception as error:
            code = error_code(error)
            # The type only: a message could carry what the owner wrote.
            logger.warning(
                "Builder stream ended with %s (%s)", code, type(error).__name__
            )
            on_event("error", {"code": code})
        finally:
            queue.put_nowait(None)

    task = asyncio.create_task(work())
    try:
        while True:
            try:
                item = await asyncio.wait_for(queue.get(), HEARTBEAT_SECONDS)
            except asyncio.TimeoutError:
                yield ": ping\n\n"
                continue
            if item is None:
                break
            yield sse(*item)
    finally:
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
