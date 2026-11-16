"""One structured model call: ``with_structured_output(schema, include_raw=True)`` so
the raw ``AIMessage`` (and its usage) comes back with the parsed object; one retry on a
validation failure, then ``StructuredOutputError`` so the node fails cleanly (spec §10).
"""

from __future__ import annotations

import time
from typing import Sequence, TypeVar

from langchain_core.language_models import BaseChatModel
from langchain_core.messages import AIMessage, BaseMessage, HumanMessage
from langchain_core.runnables import Runnable
from pydantic import BaseModel

T = TypeVar("T", bound=BaseModel)


class StructuredOutputError(RuntimeError):
    pass


# connection-shaped failures are retried with backoff (user, 2026-11-16): the local
# network (VPN reconnects) dropped three paid dry runs at their first model call
CONNECTION_RETRY_DELAYS_S = (2.0, 8.0, 30.0)  # up to 3 retries
_CONNECTION_NAMES = (
    "APIConnectionError",
    "APITimeoutError",
    "ConnectError",
    "ConnectTimeout",
    "ReadTimeout",
    "RemoteProtocolError",
    "ServiceUnavailable",
    "ConnectionError",
    "ConnectionResetError",
    "OpenAIConnectionError",
)
_sleep = time.sleep  # tests replace it


def is_connection_error(exc: BaseException) -> bool:
    seen = 0
    while exc is not None and seen < 6:
        names = {cls.__name__ for cls in type(exc).__mro__}
        if names & set(_CONNECTION_NAMES) or isinstance(exc, ConnectionError):
            return True
        exc = exc.__cause__ or exc.__context__
        seen += 1
    return False


def invoke_with_retry(fn, *args, **kwargs):
    """``fn(*args, **kwargs)``, retried on connection errors only; anything else (bad
    request, auth, validation) fails at once."""
    for attempt, delay in enumerate((*CONNECTION_RETRY_DELAYS_S, None)):
        try:
            return fn(*args, **kwargs)
        except Exception as exc:  # noqa: BLE001 - re-raised unless connection-shaped
            if delay is None or not is_connection_error(exc):
                raise
            _sleep(delay)


class StructuredCall(BaseModel):
    """What one call cost, for the budget."""

    model_config = {"arbitrary_types_allowed": True}

    raw: AIMessage | None
    seconds: float


def call_structured(
    model: BaseChatModel | Runnable,
    schema: type[T],
    messages: Sequence[BaseMessage],
    retries: int = 1,
) -> tuple[T, list[AIMessage], float]:
    """Returns ``(parsed, raw_messages, seconds)``; ``raw_messages`` has one entry per
    attempt so every attempt is charged to the budget."""
    structured = model.with_structured_output(schema, include_raw=True)
    raws: list[AIMessage] = []
    history = list(messages)
    started = time.monotonic()
    last_error: Exception | None = None
    for attempt in range(retries + 1):
        result = invoke_with_retry(structured.invoke, history)
        raw = result.get("raw") if isinstance(result, dict) else None
        if isinstance(raw, AIMessage):
            raws.append(raw)
        parsed = result.get("parsed") if isinstance(result, dict) else None
        error = result.get("parsing_error") if isinstance(result, dict) else None
        if parsed is not None and error is None:
            if not isinstance(parsed, schema):
                parsed = schema.model_validate(parsed)
            return parsed, raws, round(time.monotonic() - started, 2)
        last_error = error or ValueError("model returned no structured output")
        if attempt < retries:
            history = history + [
                HumanMessage(
                    content=(
                        "Your previous answer did not match the required schema "
                        f"({type(last_error).__name__}: {str(last_error)[:300]}). "
                        "Answer again with exactly the fields required."
                    )
                )
            ]
    raise StructuredOutputError(
        f"{schema.__name__}: no valid structured output after {retries + 1} attempts: "
        f"{type(last_error).__name__}: {str(last_error)[:300]}"
    )
