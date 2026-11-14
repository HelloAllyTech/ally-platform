"""The run's Agent logs: the exact input every agent was sent, and its full reply.

The step records (`steps`) explain a run in a few words each; these keep what
was really sent and answered, for debugging an agent and improving it later.
One entry per model call (each attempt, so a retry is its own entry) and per
code step that decides something (the plan, the profile, the dispatcher, the
top-up, guidance, the rule checks, scoring, the decision, code and data
agents). They ride on the graph state (`logs`, appended) and go back to ally-be
in the run response, which stores them in `debrief_run_logs`.

A model entry never copies the system prompt's text: where the prompt the
Skills Store served appears in the message, it is replaced by
`SYSTEM_PROMPT_MARKER`, and the entry names the prompt's code. ally-be adds the
version it served, so the message is exactly the version's text put back in
place of the marker.

Cheap by design: nothing here calls a model, and the capture is one ContextVar
read per call (`app/core/llm/capture.py`).
"""

from __future__ import annotations

import json
import math
from typing import Any, Dict, List, Optional

from app.core.debrief_graph.budget import cost_usd
from app.core.debrief_graph.context import DebriefRunContext as Ctx
from app.core.debrief_graph.records import iso

#: Stands in for the system prompt's text inside a logged message.
SYSTEM_PROMPT_MARKER = "{{system_prompt}}"

#: A code entry's input or output larger than this is cut (with a note): the
#: transcript and cards are already kept whole in the model entries.
MAX_CODE_JSON_CHARS = 60_000


def _json_safe(value: Any) -> Any:
    try:
        text = json.dumps(value, ensure_ascii=False, default=str)
    except Exception:  # noqa: BLE001
        return str(value)[:MAX_CODE_JSON_CHARS]
    if len(text) > MAX_CODE_JSON_CHARS:
        return {
            "truncated": True,
            "chars": len(text),
            "head": text[:MAX_CODE_JSON_CHARS],
        }
    return json.loads(text)


def code_log(
    ctx: Ctx,
    step: str,
    t0: float,
    *,
    input: Any,
    output: Any,
    round_: Optional[int] = None,
    error: Optional[str] = None,
    attention: bool = False,
) -> Dict[str, Any]:
    """A code step's entry: its real inputs and results, as JSON."""
    return {
        "kind": "code",
        "step": step,
        "round": round_,
        "startedAt": iso(t0),
        "t": t0,
        "ms": max(0, round(ctx.clock() - t0)),
        "input": _json_safe(input),
        "output": _json_safe(output),
        "error": error[:1000] if error else None,
        "attention": bool(attention or error),
    }


def _strip_system(prompt: str, system: Optional[str]) -> tuple[str, bool]:
    if system and system in prompt:
        return prompt.replace(system, SYSTEM_PROMPT_MARKER, 1), True
    return prompt, False


def model_logs(
    ctx: Ctx,
    *,
    step: str,
    round_: Optional[int],
    t0: float,
    primary: Optional[str],
    model: Optional[str],
    prompt_code: Optional[str],
    calls: List[Dict[str, Any]],
    body: Dict[str, Any],
    result: Optional[Dict[str, Any]],
    retries: int,
    error: Optional[str],
) -> List[Dict[str, Any]]:
    """One entry per model call the attempt made (normally one). An attempt
    that failed before reaching the model still gets an entry, with its error
    and the step's request as its input."""
    system = ctx.prompt(prompt_code) if prompt_code else None
    ms = max(0, round(ctx.clock() - t0))
    if not calls:
        sent = {k: v for k, v in body.items() if k != "system_prompt"}
        return [
            {
                "kind": "model",
                "step": step,
                "round": round_,
                "startedAt": iso(t0),
                "t": t0,
                "ms": ms,
                "model": primary or model,
                "fallbackModel": model if model and model != primary else None,
                "promptCode": prompt_code,
                "promptInlined": False,
                "input": _json_safe(sent),
                "output": _json_safe(result) if result is not None else None,
                "tokensIn": None,
                "tokensOut": None,
                "costUsd": None,
                "retries": retries,
                "error": error[:1000] if error else None,
                "attention": bool(error),
            }
        ]
    out = []
    for i, c in enumerate(calls):
        ran = c.get("model") or model
        text, inlined = _strip_system(c.get("prompt") or "", system)
        cost = cost_usd(ran, c["tokens_in"], c["tokens_out"], ctx.prices)
        call_error = c.get("error") or (error if i == len(calls) - 1 else None)
        if c.get("reply") is not None and not error:
            call_error = None
        out.append(
            {
                "kind": "model",
                "step": step,
                "round": round_,
                "startedAt": iso(t0),
                "t": t0 + i / 1000,
                "ms": ms,
                "model": primary or ran,
                "fallbackModel": ran if ran and ran != primary else None,
                "promptCode": prompt_code,
                "promptInlined": inlined,
                "input": text,
                "output": c.get("reply"),
                "tokensIn": c["tokens_in"] or None,
                "tokensOut": c["tokens_out"] or None,
                "costUsd": None if math.isinf(cost) else round(cost, 6),
                "retries": retries,
                "error": call_error[:1000] if call_error else None,
                "attention": bool(call_error),
            }
        )
    return out


def numbered(logs: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """The run's entries in the order they started, numbered from 1."""
    ordered = sorted(
        enumerate(logs or []), key=lambda p: (float(p[1].get("t") or 0), p[0])
    )
    return [
        {**{k: v for k, v in e.items() if k != "t"}, "seq": i + 1}
        for i, (_, e) in enumerate(ordered)
    ]
