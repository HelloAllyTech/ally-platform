"""Last-resort, loop-free session finalization for the force-exit path.

WHY THIS EXISTS
---------------
``finalize_session`` (app/core/queue/utils.py) is the ONLY path that ships the
learner's final score and the session-memory summary to Core. It is an
``async`` function that runs from the shutdown-callback chain, so it needs a
live, responsive event loop.

The stall watchdog exists precisely for the case where the loop is NOT
responsive: it detects a wedged session, asks for a clean ``ctx.shutdown()``,
waits a grace window, and then calls ``os._exit()`` to free the room. On that
path the shutdown callbacks never ran, so:

* no end-of-session message → the backend still sees the session as ACTIVE,
  indistinguishable from a session still in progress;
* no session_memory → the next session loses continuity;
* the learner gets 75-105s of dead air, then a dropped call with no score.

That is the worst outcome in the system: the learner did the work and the
platform has no record of it.

THE APPROACH
------------
Deliver the payload from the watchdog's OWN THREAD, synchronously, using
boto3's blocking ``send_message`` — no event loop involved at any point:

* ``ScoreKeeper.get_total_score()`` is ``self._event_score + self._behavior_score``
  over two plain ints. Reading it from another thread is safe (no await, no
  lock needed to *read*), and the worst case is missing a score delta that was
  being committed at that exact instant.
* ``RollingSummaryStore`` holds the last maintained summary in plain
  attributes, so the same applies. We send it AS-IS — no final LLM compaction,
  which would need the loop we know is blocked. This mirrors what
  ``_emit_session_memory``'s PHASE 1 already does for the disconnect path.
* ``SQSQueue.send_message_sync`` already exists and does a plain blocking
  boto3 call.

So the emergency payload is not "pre-computed and cached" (which would go
stale and could ship a score from ten turns ago) — it is computed at flush
time from the same in-memory sources ``finalize_session`` would read, just
without touching asyncio.

WHAT IT DELIBERATELY DOES NOT DO
--------------------------------
* No checkpoint cleanup — the process is about to die and take its memory
  with it.
* No final-compaction LLM call — needs the blocked loop, and the last
  maintained summary is what PHASE 1 would have sent anyway.
* One new, additive wire field: the end-of-session message carries
  ``reason`` (e.g. ``"watchdog_force_exit"``) so ally-be can record that this
  session was scored after a technical fault rather than a clean finish. The
  normal path (``finalize_session``) never sets it, so those messages are
  still byte-identical to before this field existed.

Core's session_memory processor keeps whichever write covers more messages, so
a later/duplicate delivery cannot clobber a better one. The end-of-session
message is guarded by ``_delivered`` plus the worker's ``final_score_sent``
flag so the score is not sent twice.
"""

from __future__ import annotations

import threading
from typing import Optional

from app.core.logger import get_logger

logger = get_logger(__name__)


class EmergencyFinalizer:
    """Ship the score (and last known memory) without an event loop.

    One instance per session, owned by the AgentWorker. ``flush_sync`` is
    callable from ANY thread and is idempotent: whichever path gets there
    first wins, and the loser is a no-op.
    """

    def __init__(
        self,
        *,
        room_id: str,
        thread_id: str,
        score_keeper=None,
        rolling_summary_store=None,
        client_working_memory_store=None,
        language_code: Optional[str] = None,
        queue=None,
    ) -> None:
        self._room_id = room_id
        self._thread_id = thread_id
        self._score_keeper = score_keeper
        self._rolling_summary_store = rolling_summary_store
        # The working memory's semantic record. This path was missed when the
        # write-out was wired: the two normal shutdown handlers got the store and
        # this third one did not, so a session that finalized HERE produced no
        # record at all. Observed on the post-fix Hindi v2v run — no sessionMemory
        # row, which read as "the language fix failed" when the write-out had
        # simply never run.
        self._client_working_memory_store = client_working_memory_store
        self._language_code = language_code
        # Injected for tests; defaults to the process-wide SQS queue.
        self._queue = queue

        self._lock = threading.Lock()
        self._delivered = False

    # ---- guard -----------------------------------------------------------

    def mark_delivered(self) -> None:
        """Record that the normal async path already delivered the score.

        Called from the clean-shutdown path so a force-exit that races it
        cannot send a second end-of-session message.
        """
        with self._lock:
            self._delivered = True

    @property
    def delivered(self) -> bool:
        with self._lock:
            return self._delivered

    def _claim(self) -> bool:
        """Atomically claim the right to deliver. False if already delivered."""
        with self._lock:
            if self._delivered:
                return False
            self._delivered = True
            return True

    # ---- the flush -------------------------------------------------------

    def _build_working_memory_record(self):
        """The semantic record, read WITHOUT the event loop.

        This path exists precisely because the loop did not run, so it cannot
        await `store.snapshot()`. It reads the private state directly — safe
        here and nowhere else: by the time an emergency finalize fires, no
        detached update can still be committing, and a torn read is strictly
        better than no record.

        The transcript is unavailable here, and `check_grounding` treats an
        empty transcript as missing evidence rather than proof of invention, so
        the ledger survives ungrounded rather than being discarded wholesale.
        """
        store = self._client_working_memory_store
        if store is None:
            return None
        try:
            from app.core.working_memory.writeout import build_writeout

            state = getattr(store, "_state", None)
            if state is None:
                return None
            return build_writeout(state, [])
        except Exception as exc:  # noqa: BLE001 - never block the emergency path
            logger.error(
                "[EMERGENCY-FINALIZE] working-memory record skipped room=%s: %s",
                self._room_id,
                exc,
            )
            return None

    def _get_queue(self):
        if self._queue is not None:
            return self._queue
        from app.core.queue import msg_event_queue

        return msg_event_queue

    def flush_sync(self, *, reason: str = "force_exit") -> bool:
        """Deliver the end-of-session score, then (best-effort) the memory.

        Returns True if the score message was accepted by the queue. Never
        raises — the caller is on its way to ``os._exit`` and must not be
        derailed by anything here.
        """
        if not self._claim():
            logger.info(
                "[EMERGENCY-FINALIZE] skipped room=%s reason=%s — score already "
                "delivered by the normal path",
                self._room_id,
                reason,
            )
            return False

        logger.error(
            "[EMERGENCY-FINALIZE] delivering score+memory synchronously "
            "room=%s reason=%s — the event loop did not run finalize_session",
            self._room_id,
            reason,
        )

        score_sent = self._send_score_sync(reason=reason)
        # Memory is strictly secondary: it costs the NEXT session its
        # continuity, where a lost score costs THIS session its result. Never
        # let it stop us from having sent the score.
        try:
            self._send_memory_sync()
        except Exception:  # noqa: BLE001 - nothing may escape toward os._exit
            logger.exception(
                "[EMERGENCY-FINALIZE] memory send failed room=%s", self._room_id
            )
        return score_sent

    def _send_score_sync(self, *, reason: str) -> bool:
        try:
            from app.core.queue.utils import create_session_end_message

            final_score = 0
            score_resolved = False
            if self._score_keeper is not None:
                try:
                    final_score = int(self._score_keeper.get_total_score())
                    score_resolved = True
                except Exception:  # noqa: BLE001
                    logger.exception(
                        "[EMERGENCY-FINALIZE] could not read score room=%s — "
                        "sending 0 so the session does not stay ACTIVE",
                        self._room_id,
                    )
            else:
                logger.error(
                    "[EMERGENCY-FINALIZE] no ScoreKeeper room=%s — sending 0",
                    self._room_id,
                )

            message = create_session_end_message(
                self._room_id, final_score, reason=reason
            )
            ok = bool(self._get_queue().send_message_sync(message.model_dump_json()))
            logger.error(
                "[EMERGENCY-FINALIZE] end_of_session sent=%s room=%s score=%s "
                "score_resolved=%s reason=%s",
                ok,
                self._room_id,
                final_score,
                score_resolved,
                reason,
            )
            return ok
        except Exception:  # noqa: BLE001
            logger.exception(
                "[EMERGENCY-FINALIZE] end_of_session send FAILED room=%s",
                self._room_id,
            )
            return False

    def _send_memory_sync(self) -> bool:
        """Ship the last maintained rolling summary as-is (no LLM compaction)."""
        store = self._rolling_summary_store
        if store is None:
            return False
        summary = (getattr(store, "summary", None) or "").strip()
        if not summary:
            logger.info(
                "[EMERGENCY-FINALIZE] no maintained summary room=%s — nothing "
                "to send for session_memory",
                self._room_id,
            )
            return False

        from app.core.events.schemas import CoreEventMessageType, SessionMemoryData

        covered = max(0, int(getattr(store, "covered_count", 0) or 0))
        total = max(covered, int(getattr(store, "total_count", 0) or 0))
        structured = getattr(store, "structured", None)
        wm_record = self._build_working_memory_record()
        if wm_record is not None:
            structured = dict(structured or {})
            structured["client_working_memory"] = wm_record

        memory = SessionMemoryData(
            summary=summary,
            language=self._language_code,
            message_count=total,
            summarized_message_count=covered,
            structured=structured,
        )
        message = CoreEventMessageType.create_session_memory(
            room_id=self._room_id, session_memory=memory
        )
        ok = bool(self._get_queue().send_message_sync(message.model_dump_json()))
        logger.error(
            "[EMERGENCY-FINALIZE] session_memory sent=%s room=%s coverage=%d/%d",
            ok,
            self._room_id,
            covered,
            total,
        )
        return ok
