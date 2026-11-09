"""One agent run, for both endpoints: `/agent/run` waits for the response, and
`/agent/run/stream` sends the same run's live events and then that response as
`final`. Both call `execute`, so the two can't drift.

No unchecked text is streamed. The reply's `token` events are cut from the answer
only after the run has ended, so they hold exactly what the check passed (and only
the rewrite, when the first draft was sent back). ally-be still holds them until
its crisis check clears, and `final` replaces whatever a client showed.
"""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any, AsyncIterator, Dict, List, Optional, Tuple
from uuid import uuid4

from langgraph.graph.state import CompiledStateGraph

from app.core.agent_runtime.graph import OnEvent, run_agent
from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import status_event
from app.core.config import settings
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    LLMInvocationFailedException,
    VectorDBSearchFailedException,
)
from app.schemas.agent_runtime import AgentRunRequest, AgentRunResponse
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: A comment line this often keeps proxies and ally-be from timing out a quiet run.
HEARTBEAT_SECONDS = 10.0

#: Words per `token` event: small enough to reveal smoothly, few enough events.
WORDS_PER_TOKEN = 3

_WORD = re.compile(r"\s*\S+|\s+$")


def chunk_reply(text: str) -> List[str]:
    """The reply in pieces of a few words, whitespace kept: `"".join` gives it back."""
    words = _WORD.findall(text or "")
    return [
        "".join(words[i : i + WORDS_PER_TOKEN])
        for i in range(0, len(words), WORDS_PER_TOKEN)
    ]


def build_response(state: AgentState, run_id: str) -> AgentRunResponse:
    result = state["result"]
    retrieval = {
        **result["retrieval"],
        "hit_chunk_ids": [str(hit.get("chunk_id")) for hit in state.get("hits") or []],
        "passage_document_ids": list(
            dict.fromkeys(
                str(p["document_id"])
                for p in state.get("passages") or []
                if p.get("document_id")
            )
        ),
        "passage_chunk_ids": [
            str(p["chunk_id"]) for p in state.get("passages") or [] if p.get("chunk_id")
        ],
        "searches": sum(
            1
            for call in state.get("tool_calls") or []
            if call.get("tool") == "search_knowledge"
        ),
    }
    return AgentRunResponse(
        **{**result, "retrieval": retrieval},
        run_id=run_id,
        trace=state.get("trace") or [],
    )


async def execute(
    graph: CompiledStateGraph,
    payload: AgentRunRequest,
    on_event: Optional[OnEvent] = None,
) -> AgentRunResponse:
    """Run the agent once, inside the hard cap (RUN_TIMEOUT_SECONDS).

    Raises TimeoutError past the cap; the run is cancelled with it, and the
    checkpoint keeps the steps already saved.
    """
    run_id = payload.run_id or str(uuid4())
    if on_event:
        on_event("run_started", {"run_id": run_id})
    async with asyncio.timeout(settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS):
        state = await run_agent(
            graph,
            run_id=run_id,
            conversation_id=payload.conversation_id,
            chatbot_id=payload.chatbot_id,
            question=payload.question,
            history=[turn.model_dump() for turn in payload.history],
            bot=payload.to_bot(),
            on_event=on_event,
        )
    response = build_response(state, run_id)
    if on_event and response.answer:
        on_event("status", status_event("writing"))
        for piece in chunk_reply(response.answer):
            on_event("token", {"text": piece})
    return response


def error_code(error: BaseException) -> str:
    """The stream's `error` code: no message, which could echo the request."""
    if isinstance(error, TimeoutError):
        return "timeout"
    if isinstance(
        error,
        (
            EmbeddingFailedException,
            VectorDBSearchFailedException,
            LLMInvocationFailedException,
        ),
    ):
        return "upstream"
    return "internal"


def sse(event: str, data: Dict[str, Any]) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


async def stream(
    graph: CompiledStateGraph, payload: AgentRunRequest
) -> AsyncIterator[str]:
    """The run as Server-Sent Events: run_started, status/step…, token…, then
    `final` (exactly `/agent/run`'s body) or `error`.

    Closing the generator (the client went away) cancels the run: no more model
    calls.
    """
    queue: asyncio.Queue[Optional[Tuple[str, Dict[str, Any]]]] = asyncio.Queue()

    def on_event(event: str, data: Dict[str, Any]) -> None:
        queue.put_nowait((event, data))

    async def work() -> None:
        try:
            response = await execute(graph, payload, on_event)
            on_event("final", response.model_dump(mode="json"))
        except Exception as error:
            code = error_code(error)
            # The type only: a message or traceback could carry the question.
            logger.warning(
                "Agent stream ended with %s (%s)", code, type(error).__name__
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
        # The client went away (or the run ended): stop the run and wait for it, so
        # no model call outlives the request.
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
