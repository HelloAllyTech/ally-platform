"""Who a model call is spent for: the usage scope (CR1).

ally-be names the run a request belongs to in the ``X-Ally-Usage`` header (see
``app.core.llm_usage.middleware``): a flat JSON object such as
``{"run_id", "chatbot_id", "conversation_id", "channel", "kind",
"creator_user_id", "draft_id"}``, and possibly more keys later. This module holds
it for the length of the request so every usage row emitted underneath carries
all of it, without each call site passing it along. ally-ai never derives or
renames a value (``kind`` included): what ally-be sent is what goes back.

The scope lives in a ContextVar. asyncio copies the context into every task it
spawns, so tasks started within a request (LangGraph nodes, gathered calls) see
the same scope. The scope itself is immutable; ``set_step`` swaps in a copy for
the current context only, so one node numbering its step never relabels a
sibling's. The call counter behind ``seq`` is the one mutable part, and it is
shared by every copy, so calls across a run's tasks are numbered in one sequence.
"""

from __future__ import annotations

import json
import threading
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass, field, replace
from types import MappingProxyType
from typing import Any, Dict, Iterator, Mapping, Optional, Union

Value = Union[str, int, None]

# The header's size cap, in bytes of its raw value. A larger header is ignored.
MAX_HEADER_BYTES = 1024
MAX_KEYS = 32
MAX_KEY_LENGTH = 64
# Keys this service fills in itself; a header value for them is dropped.
RESERVED_KEYS = frozenset({"step", "seq"})


class _Counter:
    """A thread-safe call counter, shared by a scope and all its copies."""

    def __init__(self) -> None:
        self._value = 0
        self._lock = threading.Lock()

    def next(self) -> int:
        with self._lock:
            self._value += 1
            return self._value


@dataclass(frozen=True)
class UsageScope:
    """The attribution for one request: ally-be's keys as sent, plus the step."""

    fields: Mapping[str, Value] = field(default_factory=lambda: MappingProxyType({}))
    step: Optional[int] = None
    counter: _Counter = field(default_factory=_Counter, compare=False, repr=False)

    def get(self, key: str) -> Value:
        return self.fields.get(key)

    @property
    def run_id(self) -> Optional[str]:
        return _as_str(self.get("run_id"))

    @property
    def chatbot_id(self) -> Optional[str]:
        return _as_str(self.get("chatbot_id"))

    @property
    def conversation_id(self) -> Optional[str]:
        return _as_str(self.get("conversation_id"))

    @property
    def kind(self) -> Optional[str]:
        return _as_str(self.get("kind"))

    def attribution(self) -> Dict[str, Any]:
        """The scope's keys for a usage row's metadata (no ``seq``)."""
        out: Dict[str, Any] = dict(self.fields)
        out["step"] = self.step
        return out


def _as_str(value: Value) -> Optional[str]:
    return None if value is None else str(value)


def _valid_value(value: Any) -> bool:
    if value is None or isinstance(value, str):
        return True
    return isinstance(value, int) and not isinstance(value, bool)


def validate_fields(raw: Any) -> Optional[Dict[str, Value]]:
    """A flat dict of str keys to str/int/None values, or None when ``raw`` isn't
    one. Any nested or other-typed value rejects the whole object: a half-read
    attribution would be worse than none. Reserved keys are dropped."""
    if not isinstance(raw, dict) or not raw or len(raw) > MAX_KEYS:
        return None
    out: Dict[str, Value] = {}
    for key, value in raw.items():
        if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
            return None
        if not _valid_value(value):
            return None
        if key in RESERVED_KEYS:
            continue
        out[key] = value
    return out if any(v is not None for v in out.values()) else None


def parse_header(value: Optional[Union[str, bytes]]) -> Optional[UsageScope]:
    """The scope an ``X-Ally-Usage`` header value names, or None when it is
    absent, over ``MAX_HEADER_BYTES``, not JSON, or not a valid flat object."""
    if not value:
        return None
    try:
        raw = value.encode("utf-8") if isinstance(value, str) else value
        if len(raw) > MAX_HEADER_BYTES:
            return None
        fields = validate_fields(json.loads(raw))
    except Exception:  # noqa: BLE001 — a bad header means no scope, never an error
        return None
    return make_scope(**fields) if fields else None


_scope: ContextVar[Optional[UsageScope]] = ContextVar("llm_usage_scope", default=None)


def current_scope() -> Optional[UsageScope]:
    return _scope.get()


def make_scope(**values: Any) -> Optional[UsageScope]:
    """A scope from keyword values (None values dropped from the check), or None
    when the values are invalid or all empty."""
    fields = validate_fields(values)
    if fields is None:
        return None
    return UsageScope(fields=MappingProxyType(fields))


@contextmanager
def use_scope(
    scope: Optional[UsageScope] = None, **values: Any
) -> Iterator[Optional[UsageScope]]:
    """Set the scope for the block: a given ``UsageScope``, or one built from
    ``run_id=..., chatbot_id=..., ...``. A block with nothing to set leaves the
    current scope as it is."""
    scope = scope or make_scope(**values)
    if scope is None:
        yield current_scope()
        return
    token = _scope.set(scope)
    try:
        yield scope
    finally:
        _scope.reset(token)


def set_step(step: Optional[int], **fallback: Any) -> None:
    """Number the current agent step for the rest of the current context.

    With no scope active, ``fallback`` (run_id, chatbot_id, ...) starts one, so a
    run reached without the header is still attributed. Never raises.
    """
    try:
        scope = current_scope() or make_scope(**fallback)
        if scope is None:
            return
        _scope.set(replace(scope, step=step))
    except Exception:  # noqa: BLE001 — attribution never fails a request
        return


def next_seq() -> Optional[int]:
    """The next call number in the current scope, or None without one."""
    scope = current_scope()
    return scope.counter.next() if scope is not None else None


def usage_attribution() -> Optional[Dict[str, Any]]:
    """The current scope's metadata for one usage row (every header key, plus
    ``step`` and ``seq``), or None without a scope. Each call takes a new seq."""
    scope = current_scope()
    if scope is None:
        return None
    out = scope.attribution()
    out["seq"] = scope.counter.next()
    return out
