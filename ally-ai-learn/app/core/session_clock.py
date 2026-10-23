"""
Session clock for pause-aware timing.

A simulation can be *paused* by the counselor (to take notes / think) and later
resumed. While paused the whole session freezes — and crucially **time freezes too**:
paused seconds must not advance time-gated event eligibility, fire scheduled time
events, or count toward billing.

``SessionClock`` is the single source of truth for *active* (un-paused) elapsed time.
One instance is created per session in the worker and shared, via the graph config,
with:

- ``app.core.graph.utils.calculate_elapsed_time`` (node-level event eligibility)
- ``app.core.events.event_orchestrator.EventOrchestrator._get_elapsed_time``
- ``app.core.events.schedulers.TimeEventScheduler`` (pause-aware ``sleep``)

so they all agree on how much *active* time has passed.
"""

import asyncio
from datetime import datetime, timezone
from typing import Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


class SessionClock:
    """Tracks active elapsed time for a session and offers a pause-aware sleep.

    "Active time" = wall-clock since the agent joined, minus all paused intervals.
    """

    def __init__(self, joined_at: datetime):
        if joined_at.tzinfo is None:
            joined_at = joined_at.replace(tzinfo=timezone.utc)
        self._joined_at = joined_at
        # Cumulative paused seconds from *completed* pause intervals.
        self._paused_offset = 0.0
        # Start of the currently-open pause, if any.
        self._paused_since: Optional[datetime] = None
        # Complementary gates kept in sync by pause()/resume(). ``_running`` is set
        # while active; ``_paused`` is set while paused. Sleepers block on these.
        self._running = asyncio.Event()
        self._running.set()
        self._paused = asyncio.Event()
        # Last utterance the persona generated, stashed by the generate_response
        # node so a pause can re-speak it on resume. Shared in-process (same
        # event loop as the graph) — no external store needed.
        self.last_agent_utterance: Optional[str] = None

    @classmethod
    def from_iso(cls, joined_iso: Optional[str]) -> "SessionClock":
        """Build from an ISO-8601 string, tolerating a trailing ``Z`` or no tz."""
        joined_at: Optional[datetime] = None
        if joined_iso:
            try:
                joined_at = datetime.fromisoformat(joined_iso.replace("Z", "+00:00"))
            except ValueError:
                logger.warning(
                    "SessionClock: bad joined_iso %r; using now()", joined_iso
                )
        if joined_at is None:
            joined_at = datetime.now(timezone.utc)
        return cls(joined_at)

    @property
    def is_paused(self) -> bool:
        return self._paused_since is not None

    @property
    def paused_offset(self) -> float:
        """Total paused seconds so far, including any currently-open pause."""
        offset = self._paused_offset
        if self._paused_since is not None:
            offset += (datetime.now(timezone.utc) - self._paused_since).total_seconds()
        return offset

    def elapsed(self) -> float:
        """Active seconds since the agent joined, excluding paused time."""
        wall = (datetime.now(timezone.utc) - self._joined_at).total_seconds()
        return max(0.0, wall - self.paused_offset)

    def pause(self) -> None:
        """Freeze the clock. Idempotent."""
        if self._paused_since is None:
            self._paused_since = datetime.now(timezone.utc)
            self._running.clear()
            self._paused.set()
            logger.info("SessionClock paused at active_elapsed=%.2fs", self.elapsed())

    def resume(self) -> None:
        """Unfreeze the clock, banking the paused interval. Idempotent."""
        if self._paused_since is not None:
            self._paused_offset += (
                datetime.now(timezone.utc) - self._paused_since
            ).total_seconds()
            self._paused_since = None
            self._paused.clear()
            self._running.set()
            logger.info("SessionClock resumed; total_paused=%.2fs", self._paused_offset)

    async def sleep(self, seconds: float) -> None:
        """Sleep for ``seconds`` of *active* time.

        Time spent paused does not count down: when a pause begins the sleeper
        stops accruing and waits until the session resumes before continuing.
        """
        remaining = float(seconds)
        while remaining > 1e-6:
            # Fully block while paused so paused time never counts down.
            await self._running.wait()
            start = datetime.now(timezone.utc)
            sleeper = asyncio.ensure_future(asyncio.sleep(remaining))
            pause_waiter = asyncio.ensure_future(self._paused.wait())
            try:
                await asyncio.wait(
                    {sleeper, pause_waiter}, return_when=asyncio.FIRST_COMPLETED
                )
            finally:
                for task in (sleeper, pause_waiter):
                    if not task.done():
                        task.cancel()
                await asyncio.gather(sleeper, pause_waiter, return_exceptions=True)
            # Subtract only the active time actually slept this iteration. If a
            # pause interrupted us, the loop re-blocks on ``_running`` above.
            remaining -= (datetime.now(timezone.utc) - start).total_seconds()
