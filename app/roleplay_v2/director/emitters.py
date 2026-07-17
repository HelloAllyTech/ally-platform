"""Outbound emitters for Director results.

Three sinks, all best-effort (a failed emit never breaks the session):

- SQS — the existing message/event queue (send_message_to_queue) using the
  standard envelope ``{message_type, room_id, timestamp, data}`` with the v2
  message types: director_state_transition, director_rubric_score,
  director_disclosure_unlock, director_stage_direction, and (at session end)
  roleplay_session_summary.
- LiveKit data channel — one reliable packet per Director turn on topic
  "director". Unlock payloads carry the secret TOPIC only, never content.
- In-memory trace — chronological list of every emitted record, consumed by
  the rehearsal harness (director_trace in the webhook payload) and tests.

The LiveKit room is optional (rehearsal/text mode passes None) and imported
only for type checking, so this module stays importable without LiveKit.
"""

from __future__ import annotations

import asyncio
import json
import time
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Set

from app.core.logger import get_logger

if TYPE_CHECKING:  # pragma: no cover
    from livekit import rtc

logger = get_logger(__name__)

# SQS message types (frozen contract with the v1 processors / ally-be).
MSG_STATE_TRANSITION = "director_state_transition"
MSG_RUBRIC_SCORE = "director_rubric_score"
MSG_DISCLOSURE_UNLOCK = "director_disclosure_unlock"
MSG_STAGE_DIRECTION = "director_stage_direction"
MSG_SESSION_SUMMARY = "roleplay_session_summary"

DATA_CHANNEL_TOPIC = "director"


class DirectorEmitter:
    """Fans Director results out to SQS, the data channel, and the trace."""

    def __init__(
        self,
        room_id: str,
        room: Optional["rtc.Room"] = None,
        *,
        enable_sqs: bool = True,
    ) -> None:
        self.room_id = room_id
        self._room = room
        self._enable_sqs = enable_sqs
        # Chronological record of everything emitted (rehearsal trace/tests).
        self.trace: List[Dict[str, Any]] = []
        self._tasks: Set[asyncio.Task] = set()

    # ------------------------------------------------------------------
    # Low-level sinks
    # ------------------------------------------------------------------

    def _track(self, coro) -> None:
        try:
            task = asyncio.create_task(coro)
        except RuntimeError:
            # No running loop (sync test contexts) — drop silently.
            logger.debug("[roleplay_v2] emitter skipped (no event loop)")
            return
        self._tasks.add(task)
        task.add_done_callback(self._tasks.discard)

    def _send_sqs(self, message_type: str, data: Dict[str, Any]) -> None:
        envelope = {
            "message_type": message_type,
            "room_id": self.room_id,
            "timestamp": int(time.time()),
            "data": data,
        }
        self.trace.append({"type": message_type, **data})
        if not self._enable_sqs:
            return
        # Deferred import: app.core.queue.utils pulls in the v1 graph package
        # at module import; importing it lazily keeps roleplay_v2 (and the
        # FastAPI router) free of that import-order cycle.
        from app.core.queue.utils import send_message_to_queue

        self._track(send_message_to_queue(json.dumps(envelope)))

    def _publish_data_channel(self, payload: Dict[str, Any]) -> None:
        if self._room is None:
            return

        async def _publish() -> None:
            try:
                await self._room.local_participant.publish_data(
                    json.dumps(payload).encode("utf-8"),
                    topic=DATA_CHANNEL_TOPIC,
                    reliable=True,
                )
            except Exception as e:  # noqa: BLE001 - UI feed is best-effort
                logger.warning(
                    "[roleplay_v2] director data-channel publish failed: %s", e
                )

        self._track(_publish())

    # ------------------------------------------------------------------
    # SQS message types (frozen payload shapes)
    # ------------------------------------------------------------------

    def emit_state_transition(
        self,
        turn_index: int,
        from_state_id: str,
        to_state_id: str,
        guard_id: Optional[str],
        observed_behavior: Optional[str],
        rationale: str,
    ) -> None:
        self._send_sqs(
            MSG_STATE_TRANSITION,
            {
                "turn_index": turn_index,
                "from_state_id": from_state_id,
                "to_state_id": to_state_id,
                "guard_id": guard_id,
                "observed_behavior": observed_behavior,
                "rationale": rationale,
            },
        )

    def emit_rubric_score(self, turn_index: int, scores: List[Dict[str, Any]]) -> None:
        """scores: [{behavior_id, score, rationale}]."""
        self._send_sqs(
            MSG_RUBRIC_SCORE,
            {"turn_index": turn_index, "scores": scores},
        )

    def emit_disclosure_unlock(
        self,
        turn_index: int,
        secret_id: str,
        unlock_condition_id: Optional[str],
        disclosed_content_summary: str,
    ) -> None:
        self._send_sqs(
            MSG_DISCLOSURE_UNLOCK,
            {
                "turn_index": turn_index,
                "secret_id": secret_id,
                "unlock_condition_id": unlock_condition_id,
                "disclosed_content_summary": disclosed_content_summary,
            },
        )

    def emit_stage_direction(
        self,
        turn_index: int,
        direction: str,
        kind: str = "stage_direction",
        event_id: Optional[str] = None,
    ) -> None:
        data: Dict[str, Any] = {
            "turn_index": turn_index,
            "direction": direction,
            "kind": kind,
        }
        if event_id is not None:
            data["event_id"] = event_id
        self._send_sqs(MSG_STAGE_DIRECTION, data)

    def emit_session_summary(
        self,
        final_state_id: str,
        state_path: List[str],
        ledger: Dict[str, str],
        cumulative_score: float,
        behavior_hits: Dict[str, int],
        director_commits: int = 0,
        director_misses: int = 0,
    ) -> None:
        self._send_sqs(
            MSG_SESSION_SUMMARY,
            {
                "final_state_id": final_state_id,
                "state_path": state_path,
                "ledger": ledger,
                "cumulative_score": cumulative_score,
                "behavior_hits": behavior_hits,
                # Director health — how many turns were scored vs. missed
                # (timeout/error). Lets downstream observe live scoring
                # reliability; additive keys, safe for existing consumers.
                "director_commits": director_commits,
                "director_misses": director_misses,
            },
        )

    # ------------------------------------------------------------------
    # Data channel (client UI feed)
    # ------------------------------------------------------------------

    def publish_turn_result(self, payload: Dict[str, Any]) -> None:
        """Publish one Director turn result on topic "director".

        The caller builds the payload; unlock entries must carry topics only
        (the DirectorService enforces this — content strings never reach the
        client).
        """
        self._publish_data_channel({"type": "director.turn", **payload})

    # ------------------------------------------------------------------
    # LLM usage + lifecycle
    # ------------------------------------------------------------------

    def emit_llm_usage(
        self,
        provider: Optional[str],
        model: Optional[str],
        usage: Optional[tuple],
        task: str = "director_turn",
    ) -> None:
        """Best-effort token-usage emit for one Director call."""
        try:
            from app.core.llm_usage.emitter import emit_llm_usage

            emit_llm_usage(self.room_id, provider, model, task=task, usage=usage)
        except Exception:  # noqa: BLE001
            logger.debug("[roleplay_v2] director usage emit skipped", exc_info=True)

    async def flush(self, timeout_s: float = 5.0) -> None:
        """Wait for in-flight emits (used at shutdown so the last turn lands)."""
        pending = [t for t in self._tasks if not t.done()]
        if not pending:
            return
        try:
            await asyncio.wait_for(
                asyncio.gather(*pending, return_exceptions=True), timeout_s
            )
        except asyncio.TimeoutError:
            logger.warning(
                "[roleplay_v2] emitter flush timed out with %d pending", len(pending)
            )
