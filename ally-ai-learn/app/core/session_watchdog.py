"""Per-session stall watchdog — detect a wedged voice session, capture WHERE it
hung, and fail it cleanly.

WHY THIS EXISTS
---------------
A live session froze mid-conversation: the learner finished a turn, the agent
never responded and never errored, and the room lingered open (an "89h" zombie
duration). A hung process stops emitting logs, so logs alone can't say where it
stuck. This watchdog:

1. Runs on its OWN thread, so it survives even a fully-blocked event loop (an
   asyncio-task watchdog would freeze with the loop).
2. Detects the wedge signature — **a finalized learner turn with NO agent
   response for `threshold` seconds** — and DUMPS EVERY THREAD'S PYTHON STACK to
   the logs, so the next freeze reveals the exact stuck call.
3. Ends the session cleanly (via the provided callback, which schedules
   ctx.shutdown on the loop).
4. Escalation: if the clean shutdown does not complete within a grace window
   (the loop is truly blocked and can't run the shutdown), force-exits THIS job
   process so the room frees and the process pool recycles. Each job runs in its
   own process, so this only ends the already-dead session.
5. Before that force-exit, runs ``on_force_exit`` — a SYNCHRONOUS callback
   invoked on this watchdog thread, which is the only thread still moving. It
   exists so the learner's score and session memory are delivered even though
   the shutdown callbacks (and therefore ``finalize_session``) never ran: see
   app/core/emergency_finalize.py. Without it a wedged session lost its score
   and transcript entirely and looked, to the backend, exactly like a session
   still in progress.

FALSE-POSITIVE SAFETY
---------------------
Only a *finalized* learner turn arms the timer, so a merely-quiet user (no turn
owed) never trips it. The timer is cleared when the agent actually produces
audio (state → "speaking") or an assistant message is added — NOT merely when it
starts "thinking", so a processing/LLM hang after "thinking" is still caught. The
threshold is far above normal turn latency (p95 was ~10s), so legitimately slow
turns don't fire.
"""

from __future__ import annotations

import os
import sys
import threading
import time
import traceback
from typing import Callable, Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


def _dump_all_thread_stacks() -> str:
    """Format every thread's current Python stack as one string.

    Runs from the watchdog thread, so it works even if the event-loop thread is
    blocked — the blocked thread's frame still yields its Python stack up to the
    blocking call, which is exactly what we need to locate the hang.
    """
    parts: list[str] = []
    for tid, frame in sys._current_frames().items():
        parts.append(f"--- thread {tid} ---")
        parts.append("".join(traceback.format_stack(frame)))
    return "\n".join(parts)


class SessionStallWatchdog:
    def __init__(
        self,
        *,
        on_stall: Callable[[], None],
        threshold_s: float = 120.0,
        poll_s: float = 5.0,
        force_exit_grace_s: float = 30.0,
        force_exit_enabled: bool = True,
        room: str = "",
        on_force_exit: Optional[Callable[[], None]] = None,
    ) -> None:
        self._on_stall = on_stall
        self._threshold = float(threshold_s)
        self._poll = float(poll_s)
        self._force_exit_grace = float(force_exit_grace_s)
        self._force_exit_enabled = bool(force_exit_enabled)
        self._room = room
        # Runs on THIS thread immediately before os._exit, so the session's
        # score/memory can be delivered without the (blocked) event loop.
        # Must be synchronous and must not raise; see flush_sync in
        # app/core/emergency_finalize.py.
        self._on_force_exit = on_force_exit

        self._lock = threading.Lock()
        # Monotonic timestamp of an unanswered finalized learner turn, or None.
        self._awaiting_since: Optional[float] = None
        self._fired = False
        self._stopped = threading.Event()
        self._thread: Optional[threading.Thread] = None

    # ---- progress signals (called from the session's event handlers) ----

    def note_user_turn_finalized(self) -> None:
        """A learner turn completed → the agent now owes a response. Arms timer."""
        with self._lock:
            if not self._fired:
                self._awaiting_since = time.monotonic()

    def note_agent_response(self) -> None:
        """The agent produced a response (audio/message) → clears the debt."""
        with self._lock:
            self._awaiting_since = None

    def suspend(self) -> None:
        """Nothing is owed right now (e.g. the session is paused)."""
        with self._lock:
            self._awaiting_since = None

    # ---- lifecycle ----

    def start(self) -> None:
        if self._thread is not None:
            return
        self._thread = threading.Thread(
            target=self._run, name="session-stall-watchdog", daemon=True
        )
        self._thread.start()

    def stop(self) -> None:
        """Stop the watchdog. Also cancels the force-exit escalation, so a clean
        shutdown (which calls this) never triggers os._exit."""
        self._stopped.set()

    # ---- the monitor loop (own thread) ----

    def _run(self) -> None:
        while not self._stopped.wait(self._poll):
            with self._lock:
                awaiting = self._awaiting_since
                fired = self._fired
            if fired or awaiting is None:
                continue
            if time.monotonic() - awaiting < self._threshold:
                continue

            # ---- WEDGE detected ----
            with self._lock:
                self._fired = True
            logger.error(
                "[WATCHDOG] session stall: learner turn unanswered for >%.0fs "
                "(room=%s) — dumping thread stacks, ending session",
                self._threshold,
                self._room,
            )
            try:
                logger.error(
                    "[WATCHDOG] stall thread stacks (room=%s):\n%s",
                    self._room,
                    _dump_all_thread_stacks(),
                )
            except Exception:
                logger.exception("[WATCHDOG] failed to dump thread stacks")

            try:
                self._on_stall()  # schedules ctx.shutdown on the event loop
            except Exception:
                logger.exception("[WATCHDOG] on_stall callback failed")

            # Escalation: wait for a clean shutdown (stop() is called by the
            # shutdown path). If it never comes, the loop is blocked — force-exit
            # this job process so the room frees and the pool recycles.
            if self._stopped.wait(self._force_exit_grace):
                return  # clean shutdown completed
            if not self._force_exit_enabled:
                logger.error(
                    "[WATCHDOG] clean shutdown did not complete and force-exit is "
                    "disabled (room=%s) — leaving session to the framework. The "
                    "final score has NOT been delivered; it will only be sent if "
                    "the event loop recovers enough to run the shutdown callbacks.",
                    self._room,
                )
                return
            logger.error(
                "[WATCHDOG] clean shutdown did not complete in %.0fs (room=%s) — "
                "force-exiting job process to free the room",
                self._force_exit_grace,
                self._room,
            )
            # LAST CHANCE to deliver the learner's score and session memory.
            # Runs here, on the watchdog thread, because this is the only
            # thread still making progress and os._exit below takes the
            # process down without running ANY shutdown callback, atexit
            # handler or finally block. Fully guarded: a failure here must
            # still let the force-exit happen, since a wedged process holding
            # the room open is the worse failure.
            if self._on_force_exit is not None:
                try:
                    self._on_force_exit()
                except Exception:
                    logger.exception(
                        "[WATCHDOG] on_force_exit (emergency finalize) failed "
                        "(room=%s) — proceeding with force-exit",
                        self._room,
                    )
            try:
                sys.stderr.flush()
            except Exception:
                pass
            os._exit(75)  # dedicated per-job process; supervisor recycles it
        return
