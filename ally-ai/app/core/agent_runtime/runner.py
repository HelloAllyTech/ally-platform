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

from app.core.agent_runtime import activity, stages
from app.core.agent_runtime.budget import RUN_CAP_S, RUN_DEADLINE
from app.core.agent_runtime.gateway import AgentGatewayClient
from app.core.agent_runtime.graph import OnEvent, run_agent
from app.core.agent_runtime.state import AgentState
from app.core.agent_runtime.trace import status_event
from app.core.config import settings
from app.core.llm.dispatch import SDK_RETRIES
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
        memory_writes=state.get("memory_writes") or [],
        activity=activity.done(state.get("activity") or []),
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
    # The cap ally-be named (chunk H1), never above the configured ceiling of 60 s.
    cap_s = min(
        payload.run_timeout_s or settings.AGENT_RUNTIME.RUN_TIMEOUT_SECONDS, 60.0
    )
    RUN_CAP_S.set(cap_s)
    # Each model call gets the time left of the cap and no SDK retries (chunk H1).
    SDK_RETRIES.set(0)
    clock = stages.begin(run_id)
    stages.stage(
        "run_start",
        streamed=bool(on_event),
        history=len(payload.history),
        gateway=bool(payload.gateway),
        cap_s=cap_s,
    )
    if on_event:
        on_event("run_started", {"run_id": run_id})
    # ally-be's tool gateway (chunk 3b): one client for the run, closed with it.
    gateway = (
        AgentGatewayClient(
            payload.gateway.url, payload.gateway.token.get_secret_value()
        )
        if payload.gateway
        else None
    )
    try:
        async with asyncio.timeout(cap_s) as cap:
            # A write extends the cap (chunk 8a, budget.extend_after_write).
            RUN_DEADLINE.set(cap)
            state = await run_agent(
                graph,
                run_id=run_id,
                conversation_id=payload.conversation_id,
                chatbot_id=payload.chatbot_id,
                question=payload.question,
                history=[turn.model_dump() for turn in payload.history],
                bot=payload.to_bot(),
                on_event=on_event,
                gateway=gateway,
            )
    except TimeoutError:
        stages.stage(
            "run_end",
            reason="timeout",
            ended_by="ally-ai_run_cap",
            cut_off=clock["active"],
        )
        raise
    except asyncio.CancelledError:
        stages.stage(
            "run_end",
            reason="cancelled",
            ended_by="caller_went_away",
            cut_off=clock["active"],
        )
        raise
    except Exception as error:
        stages.stage(
            "run_end",
            reason="error",
            error=type(error).__name__,
            cut_off=clock["active"],
        )
        raise
    finally:
        if gateway:
            await gateway.aclose()
    response = build_response(state, run_id)
    stages.stage(
        "run_end",
        reason="finished",
        intent=response.intent,
        reply_chars=len(response.answer or ""),
    )
    if on_event and response.answer:
        on_event("status", status_event("writing"))
        stages.stage("first_token")
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
        if not task.done():
            logger.info(
                "[AGENT STAGE] run=%s stage=stream_closed_early "
                "ended_by=caller_went_away",
                payload.run_id,
            )
        task.cancel()
        await asyncio.gather(task, return_exceptions=True)
