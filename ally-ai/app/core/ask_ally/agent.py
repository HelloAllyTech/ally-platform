"""One Ask Ally reply: the agent, run and streamed.

Events, one JSON object per line (CONTRACT.md §5):

- `{"type": "token", "text": ...}` — reply text as it arrives, every pass;
- `{"type": "done", "text", "tool_texts", "trace", "distress"}` — the reply
  finished;
- `{"type": "error", "error", "text", "trace", "distress"}` — it stopped;
  `text` is what the learner already saw (ally-be finishes with it, or reports
  the error).

`distress` (both last events): the Safety reader, run in-process alongside the
reply from the first moment, found the learner's own distress in the message.
False when it found none, and when the reading failed or took longer than
`DISTRESS_TIMEOUT_S` — ally-be's keyword screen already ran before the call.
The reply's words never wait for it; only the last event does.

Never traced to LangSmith: the reply carries the learner's words.
"""

from __future__ import annotations

import asyncio
from typing import Any, AsyncIterator, Awaitable, Callable, Dict, Optional

from langchain.agents import create_agent
from langchain.agents.middleware import (
    ModelCallLimitMiddleware,
    ModelRetryMiddleware,
    ToolErrorMiddleware,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessageChunk
from langsmith.run_helpers import tracing_context

from app.core.ask_ally.context import ReplyRun
from app.core.ask_ally.middleware import ReplyLimits, ToolTrace, tool_unavailable
from app.core.ask_ally.models import build_reply_model
from app.core.ask_ally.schemas import AskAllyRequest
from app.core.ask_ally.tools import ASK_ALLY_TOOLS
from app.core.debrief.safety_reader import TranscriptTurn, read_safety
from app.core.debrief_graph.gateway import Gateway, HttpGateway
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: Each tool must answer within this, or the model is told it is unavailable.
TOOL_TIMEOUT_S = 1.5
#: One retry for a pass that failed before any of its words reached the learner.
MODEL_RETRIES = 1
#: How long the Safety reader may take: about one and a half times the slowest
#: healthy call in prod over 30 days (Oct–Nov 2026, longest 42 s), so a stuck
#: call is cut while a slow one still finishes. Was ally-be's
#: SAFETY_READER_TIMEOUT_MS on the old HTTP hop.
DISTRESS_TIMEOUT_S = 60.0

DistressReader = Callable[[AskAllyRequest], Awaitable[bool]]


async def read_distress(req: AskAllyRequest) -> bool:
    """True when the Safety reader finds the learner's own distress in the
    message: the message read as one counsellor turn, on the default safety
    model, as ally-be's old `readDistress` sent it."""
    reading, _ = await read_safety(
        [TranscriptTurn(turn_index=1, role="counselor", text=req.message)],
        req.language,
        system=req.safety_system,
        scenario_session_id=req.scenario_session_id,
    )
    if reading is None:
        # No usable answer: the old endpoint's 502, which ally-be read as false.
        raise ValueError("safety reader returned no usable answer")
    return len(reading.learner_distress) > 0


async def _settle_distress(task: "asyncio.Task[bool]", run_id: str) -> bool:
    try:
        return bool(await asyncio.wait_for(task, DISTRESS_TIMEOUT_S))
    except Exception as e:  # noqa: BLE001 - a failed read adds nothing
        logger.warning(
            "Ask Ally distress read for run %s failed: %s", run_id, type(e).__name__
        )
        return False


def build_agent(run: ReplyRun, model: BaseChatModel, system: str):
    return create_agent(
        model,
        tools=ASK_ALLY_TOOLS,
        system_prompt=system,
        context_schema=ReplyRun,
        middleware=[
            ReplyLimits(),
            # A pass that already streamed words is never retried: the learner
            # would see the start of a second, different answer.
            ModelRetryMiddleware(
                max_retries=MODEL_RETRIES,
                retry_on=lambda e: not run.pass_has_text,
                on_failure="error",
                initial_delay=0.2,
                jitter=False,
            ),
            # Backstop only: ReplyLimits' closing pass forbids tools, so the
            # loop ends on that pass before this limit is ever reached.
            ModelCallLimitMiddleware(
                run_limit=run.reply.max_turns, exit_behavior="end"
            ),
            ToolTrace(),
            ToolErrorMiddleware(aon_error=tool_unavailable(run)),
        ],
    )


def _recursion_limit(max_turns: int) -> int:
    # Per pass: the model node, its middleware hooks and the tools node.
    return 6 * max_turns + 4


def _event(kind: str, **data: Any) -> Dict[str, Any]:
    return {"type": kind, **data}


async def stream_reply(
    req: AskAllyRequest,
    *,
    gateway: Optional[Gateway] = None,
    model_factory: Callable[..., BaseChatModel] = build_reply_model,
    distress_reader: DistressReader = read_distress,
) -> AsyncIterator[Dict[str, Any]]:
    # Read alongside the reply, never in front of it: first words stay fast.
    distress = asyncio.ensure_future(distress_reader(req))
    gw = gateway or HttpGateway(req.gateway_url, req.run_token, TOOL_TIMEOUT_S)
    run = ReplyRun(
        run_id=req.run_id,
        session_id=req.scenario_session_id,
        chat_id=req.chat_id,
        tenant_id=req.tenant_id,
        reply=req.reply,
        prices=req.prices,
        gateway=gw,
    )
    try:
        if req.reply.model not in req.prices:
            # Unpriced = cannot run (plan §8.9): the budget could not hold it.
            raise ValueError(f"{req.reply.model} has no price")
        agent = build_agent(run, model_factory(req.reply), req.system)
        messages = [m.model_dump() for m in req.history] + [
            {"role": "user", "content": req.message}
        ]
        with tracing_context(enabled=False):
            async for chunk, meta in agent.astream(
                {"messages": messages},
                {
                    "recursion_limit": _recursion_limit(req.reply.max_turns),
                    "run_name": "ask_ally_reply",
                    "metadata": {"run_id": req.run_id},
                },
                context=run,
                stream_mode="messages",
            ):
                if meta.get("langgraph_node") != "model" or not isinstance(
                    chunk, AIMessageChunk
                ):
                    continue
                text = chunk.text
                if text:
                    run.streamed.append(text)
                    yield _event("token", text=text)
        done = _event(
            "done", text=run.text, tool_texts=run.tool_texts, trace=run.trace()
        )
        done["distress"] = await _settle_distress(distress, req.run_id)
        yield done
    except Exception as e:  # noqa: BLE001 - reported to ally-be, which decides
        logger.warning(
            "Ask Ally reply for run %s failed: %s", req.run_id, type(e).__name__
        )
        yield _event(
            "error",
            error=(str(e) or type(e).__name__)[:300],
            text=run.text,
            trace=run.trace(),
            distress=await _settle_distress(distress, req.run_id),
        )
    finally:
        if not distress.done():
            distress.cancel()
        try:
            await gw.aclose()
        except Exception:  # noqa: BLE001
            pass
