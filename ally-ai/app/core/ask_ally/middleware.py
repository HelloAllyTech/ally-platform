"""The reply's limits and its run-view record, as `create_agent` middleware.

What the library does for us: the tool loop itself (`create_agent`), a hard
cap on passes (`ModelCallLimitMiddleware`), retrying a failed pass
(`ModelRetryMiddleware`) and turning a failed tool into a message the model
can read (`ToolErrorMiddleware`).

What stays here, because no middleware does it:

- **the closing pass**: the last allowed pass — or the first one the dollar
  budget can't stretch past — forbids tools (`tool_choice="none"`), so a reply
  always ends in words for the learner. `ModelCallLimitMiddleware` would
  instead end the loop with its own "limit reached" message;
- **the dollar budget**: each pass's cost from its token usage and the
  release's prices (the debrief graph's `cost_usd`), recorded to `llm_usage`;
- **the trace**: each tool call's name, topic, outcome, time and one-line
  result, for the Debrief Console's run view.
"""

from __future__ import annotations

import time
from typing import Any, Awaitable, Callable

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
    ToolCallRequest,
)
from langchain_core.messages import AIMessage, ToolMessage

from app.core.ask_ally.context import ReplyRun
from app.core.debrief_graph.budget import cost_usd
from app.core.llm_usage.emitter import emit_llm_usage
from app.core.llm_usage.tasks import LLMTask

#: Told to the model in place of a tool that failed or was too slow.
TOOL_UNAVAILABLE = (
    "This is unavailable right now. Answer from the debrief and the session."
)
#: Another tool pass is allowed only if one like the last, and then a closing
#: pass, would still fit the budget with this margin.
BUDGET_MARGIN = 1.2


def _last_ai(response: Any) -> AIMessage | None:
    messages = response.result if isinstance(response, ModelResponse) else [response]
    return next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)


class ReplyLimits(AgentMiddleware):
    """Closing pass, dollar budget and per-pass usage records."""

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ):
        run: ReplyRun = request.runtime.context
        turn = run.turns
        final_turn = turn >= run.reply.max_turns - 1
        over_budget = (
            turn > 0
            and run.cost_usd + 2 * run.last_turn_cost * BUDGET_MARGIN > run.reply.budget
        )
        if final_turn or over_budget:
            if turn > 0:
                run.stopped_by = (
                    "budget" if over_budget and not final_turn else "max_turns"
                )
            request = request.override(tool_choice="none")
        run.pass_start = len(run.streamed)
        response = await handler(request)
        run.turns += 1
        message = _last_ai(response)
        usage = (message.usage_metadata if message else None) or {}
        prompt = int(usage.get("input_tokens") or 0)
        completion = int(usage.get("output_tokens") or 0)
        cost = cost_usd(run.reply.model, prompt, completion, run.prices)
        run.last_turn_cost = cost
        run.cost_usd += cost
        cached = (usage.get("input_token_details") or {}).get("cache_read")
        emit_llm_usage(
            run.reply.provider,
            run.reply.model,
            LLMTask.DEBRIEF_REPLY.value,
            (prompt, completion, int(usage.get("total_tokens") or 0)),
            scenario_session_id=run.session_id,
            cached_tokens=int(cached) if cached else None,
            metadata={
                "chatId": run.chat_id,
                "runId": run.run_id,
                "model": run.reply.model,
                **({"tenantId": run.tenant_id} if run.tenant_id else {}),
            },
        )
        return response


class ToolTrace(AgentMiddleware):
    """One run-view record per tool call; keeps what a successful tool
    returned for the quote check. Sits outside `ToolErrorMiddleware`, so a
    failed tool arrives here as an error `ToolMessage`."""

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[Any]],
    ):
        run: ReplyRun = request.runtime.context
        call_id = request.tool_call.get("id") or ""
        t0 = time.monotonic()
        result = await handler(request)
        ms = round((time.monotonic() - t0) * 1000)
        ok = not (isinstance(result, ToolMessage) and result.status == "error")
        found, topic = run.found.pop(call_id, ("", None))
        if not ok:
            found = f"unavailable ({run.errors.pop(call_id, 'error')[:60]})"
            topic = None
        elif isinstance(result, ToolMessage) and isinstance(result.content, str):
            run.tool_texts.append(result.content)
        run.tools.append(
            {
                "name": request.tool_call.get("name"),
                **({"topic": topic} if topic else {}),
                "ok": ok,
                "ms": ms,
                "found": found,
            }
        )
        return result


def tool_unavailable(run: ReplyRun):
    """`ToolErrorMiddleware`'s handler: the model hears the tool is unavailable;
    the run view keeps why."""

    async def on_error(error: Exception, request: ToolCallRequest) -> str:
        run.errors[request.tool_call.get("id") or ""] = (
            str(error) or type(error).__name__
        )
        return TOOL_UNAVAILABLE

    return on_error
