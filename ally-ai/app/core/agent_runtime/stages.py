"""One log line per stage of an agent run (chunk H1, Part A): where a turn's time goes.

`[AGENT STAGE] run=<run id> stage=<name> t_ms=<since the run started> key=value…`

The run id is ally-be's, so these lines join ally-be's own `[AGENT STAGE]` and
`[AGENT TOOL]` lines. Values are names, counts, codes and milliseconds only: never
the question, a passage, a tool's input or the reply.

Outside a run (no clock set) every call here does nothing, so shared code (the model
dispatch) can report without knowing whether it is inside an agent run.

Also holds the test-only slow tool (`DEBUG_TOOL_DELAY_SECONDS`), which proves where
the run's cutoff fires. It never applies outside a development environment.
"""

from __future__ import annotations

import asyncio
import time
from contextvars import ContextVar
from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import ENV
from app.utils.logger import get_logger

logger = get_logger(__name__)

#: The running run's clock: its id, when it started and the stage it is in. A dict,
#: so a stage set inside a graph task is seen by the runner that started it.
_CLOCK: ContextVar[Optional[Dict[str, Any]]] = ContextVar(
    "agent_stage_clock", default=None
)


def begin(run_id: str) -> Dict[str, Any]:
    """Start the clock for one run; returns it, so the runner can read `active`."""
    clock = {"run_id": run_id, "t0": time.monotonic(), "active": "start"}
    _CLOCK.set(clock)
    return clock


def elapsed_ms(clock: Optional[Dict[str, Any]] = None) -> int:
    clock = clock or _CLOCK.get()
    return int((time.monotonic() - clock["t0"]) * 1000) if clock else 0


def stage(name: str, *, active: Optional[str] = None, **fields: Any) -> None:
    """Log one stage of the current run. `active` also records what the run is
    doing now, so a timeout can say which stage it cut off."""
    clock = _CLOCK.get()
    if clock is None:
        return
    if active is not None:
        clock["active"] = active
    extra = " ".join(f"{key}={_value(value)}" for key, value in fields.items())
    logger.info(
        "[AGENT STAGE] run=%s stage=%s t_ms=%d%s",
        clock["run_id"],
        name,
        elapsed_ms(clock),
        f" {extra}" if extra else "",
    )


def _value(value: Any) -> str:
    if isinstance(value, float):
        return f"{value:.2f}"
    return str(value).replace(" ", "_")[:80]


def debug_tool_delay_seconds() -> float:
    """The test-only delay inside a gateway tool call, in seconds: 0 unless set, and
    always 0 outside a development environment, whatever is set."""
    seconds = settings.AGENT_RUNTIME.DEBUG_TOOL_DELAY_SECONDS
    if seconds <= 0:
        return 0.0
    if str(settings.ENV.ENV).upper() not in (ENV.DEV.value, ENV.DEVELOPMENT.value):
        return 0.0
    return seconds


async def debug_tool_delay(when: str, tool: str) -> None:
    """Sleep inside a gateway call, `before` or `after` ally-be does the work, when
    the test-only delay is on for that side."""
    seconds = debug_tool_delay_seconds()
    if not seconds or settings.AGENT_RUNTIME.DEBUG_TOOL_DELAY_WHEN != when:
        return
    stage("debug_delay_start", tool=tool, when=when, seconds=seconds)
    await asyncio.sleep(seconds)
    stage("debug_delay_end", tool=tool, when=when)
