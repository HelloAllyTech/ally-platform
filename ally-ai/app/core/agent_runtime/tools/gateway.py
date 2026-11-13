"""Gateway tools (chunk 3b): tools that ask ally-be to act, through its gateway.

A gateway tool is a name, a description, an input model, a risk and `ends_run`.
Its handler posts `{run_id, step, input}` to ally-be with the run's client and
returns what came back as a record the agent reads. A failure (a timeout, a 4xx or
5xx, `ok: false`) is a result, never a crashed run.

A new gateway tool is one module here (see `hand_over.py`) and one in ally-be's
`src/chatbot/agent-tools/`.
"""

from __future__ import annotations

from typing import Callable, Dict, Optional, Type

from pydantic import BaseModel

from app.core.agent_runtime.tools.base import Risk, Tool, ToolContext, ToolResult


def gateway_tool(
    name: str,
    description: str,
    input_model: Type[BaseModel],
    risk: Risk,
    ends_run: bool = False,
    prepare: Optional[Callable[[BaseModel], Dict]] = None,
) -> Tool:
    """A Tool whose handler calls ally-be. `prepare` turns the validated input into
    the body's `input` (by default, the model's fields)."""

    async def handler(args: BaseModel, ctx: ToolContext) -> ToolResult:
        if ctx.gateway is None or ctx.run_id is None or ctx.step is None:
            # Offered only with a gateway, so unreachable; still a result, not a crash.
            outcome = {"ok": False, "error": "no_gateway"}
        else:
            body = prepare(args) if prepare else args.model_dump(mode="json")
            outcome = await ctx.gateway.call(
                name, run_id=ctx.run_id, step=ctx.step, input=body
            )
        ok = bool(outcome.get("ok"))
        record = {"tool": name, "kind": "gateway", "ok": ok}
        if not ok:
            record["error"] = str(outcome.get("error") or "failed")
        return ToolResult(
            summary=f"{name}: ok" if ok else f"{name}: error {record['error']}",
            record=record,
        )

    return Tool(
        name=name,
        description=description,
        input_model=input_model,
        risk=risk,
        handler=handler,
        kind="gateway",
        ends_run=ends_run,
    )
