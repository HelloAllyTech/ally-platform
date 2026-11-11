"""The run's guard: model order, dollar budget, usage and step records.

What the libraries do for us: the agent loop, planning, subagents, skills and
memory (`create_deep_agent`); turning a failed tool into a message the model can
read (`handle_tool_error` on each tool).

What stays here, because no middleware does it:

- **model order**: the debrief graph's circuit breaker (`models_to_try`) puts the
  backup first while the primary model's breaker is open, and a failed call is
  tried once on the other model;
- **the dollar budget**: each call's cost from its token usage and ally-be's prices
  (the debrief graph's `cost_usd`), recorded to `llm_usage` as `debrief_improver` so
  ally-be counts it against the learning budget; once another call like the last
  would go over, the next model call ends the loop instead of calling the model;
- **our own trace** (spec D6): one step record per model and tool call. Comment
  text and quotes never go into a record.

One instance per agent (main, investigator) over the run's shared ledger.
"""

from __future__ import annotations

import json
from typing import Any, Awaitable, Callable, Dict, List, Optional

from langchain.agents.middleware import (
    AgentMiddleware,
    ModelRequest,
    ModelResponse,
    ToolCallRequest,
)
from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, ToolMessage

from app.core.debrief_graph.budget import cost_usd
from app.core.debrief_graph.circuit import (
    models_to_try,
    record_model_failure,
    record_model_success,
)
from app.core.llm.dispatch import infer_provider_from_model
from app.core.llm_usage.emitter import emit_llm_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.pm_agent.ledger import RunLedger, now_ms
from app.core.pm_agent.quotes import strip_quotes

BUDGET_SPENT = (
    "The run's budget is spent. Stop here: write the report with what you have."
)


def _last_ai(response: Any) -> Optional[AIMessage]:
    messages = response.result if isinstance(response, ModelResponse) else [response]
    return next((m for m in reversed(messages) if isinstance(m, AIMessage)), None)


def _text(message: Optional[AIMessage]) -> str:
    if message is None:
        return ""
    content = message.content
    if isinstance(content, list):
        content = " ".join(
            b.get("text", "") if isinstance(b, dict) else str(b) for b in content
        )
    return str(content or "")


def _brief(text: str, n: int = 300) -> Optional[str]:
    text = strip_quotes(text)[0].strip()
    return text[:n] or None


#: What a tool's JSON answer keeps in its step record: ids, outcomes, counts.
_RECORD_KEYS = (
    "idea_id",
    "route",
    "kind",
    "ok",
    "status",
    "linked_comments",
    "quotes_removed",
    "next",
    "waiting_for",
    "refused",
)


def _tool_output(content: str, n: int = 300) -> Optional[str]:
    """A tool answer for the run view: the outcome fields of a JSON answer (never
    its free text), else the quote-stripped text."""
    try:
        data = json.loads(content)
    except (ValueError, TypeError):
        return _brief(content, n)
    if not isinstance(data, dict):
        return f"{len(data)} rows" if isinstance(data, list) else None
    kept = {k: data[k] for k in _RECORD_KEYS if k in data}
    for k in ("rows", "comments", "failure_points"):
        if isinstance(data.get(k), list):
            kept[k] = len(data[k])
    return json.dumps(kept, ensure_ascii=False)[:n] or None


class PmRunGuard(AgentMiddleware):
    def __init__(
        self,
        ledger: RunLedger,
        models: Dict[str, BaseChatModel],
        primary: str,
        backup: Optional[str],
        label: str = "main",
    ) -> None:
        super().__init__()
        self.ledger = ledger
        self.models = models
        self.primary = primary
        self.backup = backup
        self.label = label

    @property
    def name(self) -> str:  # one per agent; names must differ within a stack
        return f"PmRunGuard[{self.label}]"

    def _order(self) -> List[str]:
        order: List[str] = []
        for m in models_to_try(self.primary, self.backup):
            if m and m in self.models and m not in order:
                order.append(m)
        for m in self.models:  # whatever else can run, last
            if m not in order:
                order.append(m)
        return order

    async def awrap_model_call(
        self,
        request: ModelRequest,
        handler: Callable[[ModelRequest], Awaitable[ModelResponse]],
    ):
        ledger = self.ledger
        if ledger.cannot_afford_another():
            ledger.stopped_for_budget = True
            return ModelResponse(result=[AIMessage(content=BUDGET_SPENT)])
        order = self._order()
        if not order:
            raise RuntimeError("no priced model this environment can run")
        last_error: Optional[Exception] = None
        # The model, then its backup; with one model, that model twice (as the
        # debrief graph's steps do without a backup).
        tries = order[:2] if len(order) > 1 else order * 2
        for attempt, name in enumerate(tries):
            t0 = now_ms()
            try:
                response = await handler(request.override(model=self.models[name]))
            except Exception as e:  # noqa: BLE001 - tried once on the other model
                record_model_failure(name)
                last_error = e
                ledger.record(
                    t0,
                    step="model",
                    agent=self.label,
                    status="failed",
                    model=name,
                    note=f"{type(e).__name__}"[:200],
                )
                continue
            message = _last_ai(response)
            usage = (message.usage_metadata if message else None) or {}
            prompt = int(usage.get("input_tokens") or 0)
            completion = int(usage.get("output_tokens") or 0)
            cost = cost_usd(name, prompt, completion, ledger.prices)
            ledger.spent_usd += cost
            ledger.last_call_usd = cost
            emit_llm_usage(
                infer_provider_from_model(name),
                name,
                LLMTask.DEBRIEF_PM_AGENT.value,
                (prompt, completion, int(usage.get("total_tokens") or 0)),
                metadata={"agentRunId": ledger.run_id, "agent": self.label},
            )
            calls = [c.get("name") for c in (message.tool_calls if message else [])]
            text = _text(message).strip()
            if not calls and not text and attempt + 1 < len(tries):
                # An empty answer (Gemini sometimes returns nothing after a tool
                # error) would end the run silently: try the other model once.
                record_model_failure(name)
                ledger.record(
                    t0,
                    step="model",
                    agent=self.label,
                    status="failed",
                    model=name,
                    note="empty answer",
                    estimatedUsd=round(cost, 4),
                    inputs=[f"{prompt} tokens in", f"{completion} tokens out"],
                )
                continue
            record_model_success(name)
            if name not in ledger.models_used:
                ledger.models_used.append(name)
            ledger.record(
                t0,
                step="model",
                agent=self.label,
                status="done",
                model=name,
                note="retried" if attempt else None,
                estimatedUsd=round(cost, 4),
                inputs=[f"{prompt} tokens in", f"{completion} tokens out"],
                reasoning=_brief(text, 600),
                output=", ".join(c for c in calls if c) or None,
            )
            return response
        raise last_error or RuntimeError("model call failed")

    async def awrap_tool_call(
        self,
        request: ToolCallRequest,
        handler: Callable[[ToolCallRequest], Awaitable[Any]],
    ):
        name = request.tool_call.get("name") or "tool"
        args = request.tool_call.get("args") or {}
        t0 = now_ms()
        result = await handler(request)
        content = (
            result.content
            if isinstance(result, ToolMessage) and isinstance(result.content, str)
            else ""
        )
        status = "done"
        if content.startswith("Refused by ally-be"):
            status = "refused"
        elif (isinstance(result, ToolMessage) and result.status == "error") or (
            content.startswith(f"{name} failed")
        ):
            status = "failed"
        output = _tool_output(content)
        self.ledger.record(
            t0,
            step=name,
            agent=self.label,
            status=status,
            inputs=sorted(str(k) for k in args)[:12],
            output=output,
        )
        return result
