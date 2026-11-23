"""What a model call was sent and what it answered, for a caller that asks.

The debrief's Agent logs keep the exact message every agent was sent and its
full reply. Those are built deep inside the step functions, so instead of
threading them back up every return value, a caller opens a capture around
its call and `generate_structured` (and its usage accounting) write into it:

    with capture_calls() as calls:
        await steps.run(...)
    calls[0]["prompt"], calls[0]["reply"], calls[0]["tokens_in"]

No capture open (every other caller) means nothing is recorded and nothing is
kept: one ContextVar read per call. A ContextVar follows the asyncio task, so
parallel calls (the safety reader beside the Analyst) never mix.
"""

from __future__ import annotations

from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any, Dict, Iterator, List, Optional

_calls: ContextVar[Optional[List[Dict[str, Any]]]] = ContextVar(
    "llm_call_capture", default=None
)


@contextmanager
def capture_calls() -> Iterator[List[Dict[str, Any]]]:
    """Record every structured call made inside the block, in order."""
    calls: List[Dict[str, Any]] = []
    token = _calls.set(calls)
    try:
        yield calls
    finally:
        _calls.reset(token)


def call_started(
    *,
    prompt: str,
    system: Optional[str],
    task: Optional[str],
    provider: Optional[str],
    model: Optional[str],
) -> Optional[Dict[str, Any]]:
    """The record for one call, when a capture is open; None otherwise."""
    calls = _calls.get()
    if calls is None:
        return None
    record: Dict[str, Any] = {
        "prompt": prompt,
        "system": system,
        "task": task,
        "provider": provider,
        "model": model,
        "fell_back_from": None,
        "reply": None,
        "error": None,
        "tokens_in": 0,
        "tokens_out": 0,
    }
    calls.append(record)
    return record


def usage_reported(prompt_tokens: int, completion_tokens: int) -> None:
    """Token usage for the call in flight (summed over a provider fallback)."""
    calls = _calls.get()
    if not calls:
        return
    calls[-1]["tokens_in"] += int(prompt_tokens or 0)
    calls[-1]["tokens_out"] += int(completion_tokens or 0)


def reply_of(parsed: Any) -> Any:
    """The structured answer as JSON, exactly as the model's schema holds it."""
    if parsed is None:
        return None
    dump = getattr(parsed, "model_dump", None)
    if callable(dump):
        try:
            return dump(mode="json")
        except Exception:  # noqa: BLE001 - a reply is never worth failing a call
            pass
    return parsed if isinstance(parsed, (dict, list, str)) else str(parsed)
