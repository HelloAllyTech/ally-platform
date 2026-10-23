"""SupervisorNotesService — live coaching hints during a roleplay session.

A second, cheap LLM reads each committed learner turn alongside the actor and
occasionally sends the learner a one-line hint, which the client renders in a
"Supervisor" tab in the session sidebar. Same character as the post-session
debrief note, and the notes are persisted so that debrief can pick a thread up
("as I mentioned during the session…").

Two gates, both required: ``settings.SUPERVISOR_NOTES_ENABLED`` is the global
kill-switch (default on) and the per-simulation ``supervisor_notes_enabled``
toggle (Studio: supervisorNotesEnabled, default off) is the opt-in — so live
notes are off for every scenario unless an author turns them on. Mid-session
feedback is deliberately not the default: it helps a novice who is unsure what
good looks like, and it breaks the authentic pressure a more experienced learner
came for.

Off the critical path, always
-----------------------------
``on_learner_turn_committed`` spawns a tracked task with a hard timeout, exactly
like the v2 Director. A slow or failing supervisor can only MISS a note; it can
never delay the actor's reply. Latency is the product here — every branch below
is wrapped, and a raised exception in this file would be a bug, not a note.

Sparsity is enforced in code, not in the prompt
-----------------------------------------------
The prompt argues for silence, but an LLM asked whether to speak will tend to
speak. So the caps are structural: at most ``SUPERVISOR_NOTES_MAX_PER_SESSION``
notes, and at least ``SUPERVISOR_NOTES_MIN_TURN_GAP`` learner turns between two
of them. Past roughly ten hints the tab stops being help and starts competing
with the roleplay for the learner's attention.
"""

from __future__ import annotations

import asyncio
import json
import time
from collections import deque
from typing import Any, Callable, Deque, Optional, Set, Tuple

from langchain_core.messages import HumanMessage, SystemMessage

from app.core.config import settings
from app.core.events.schemas import CoreEventMessageType, SupervisorNoteData
from app.core.llm_usage.emitter import emit_llm_usage
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger
from app.core.supervisor.schemas import SupervisorNoteVerdict
from app.core.tasks import spawn_background_task
from app.core.time_utils import get_current_iso_timestamp
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

#: LiveKit data-channel topic the notes are published on. The client filters on
#: this, so it must not change without the frontend changing with it.
SUPERVISOR_DATA_TOPIC = "supervisor"

#: Wire type inside the packet, so the client can branch on it the way it
#: already branches on AGENT_STATE / director.turn.
SUPERVISOR_NOTE_TYPE = "supervisor.note"

DEFAULT_TIMEOUT_S = 6.0
DEFAULT_MAX_NOTES = 10
DEFAULT_MIN_TURN_GAP = 2
#: Turns of conversation the supervisor sees. Enough to judge where the learner
#: is heading; short enough that the call stays cheap at per-turn frequency.
DEFAULT_WINDOW_TURNS = 12
#: A hint the learner reads mid-conversation has to be glanceable.
MAX_NOTE_CHARS = 240


def is_supervisor_notes_enabled(scenario=None) -> bool:
    """Whether live supervisor notes are on for this session.

    Two gates, both required (same shape as comfort audio):
    ``settings.SUPERVISOR_NOTES_ENABLED`` is the global kill-switch (default
    on), and ``prompt_data.supervisor_notes_enabled`` is the per-simulation
    opt-in (default off, set in Studio).
    """
    if not getattr(settings, "SUPERVISOR_NOTES_ENABLED", True):
        return False
    prompt_data = getattr(scenario, "prompt_data", None)
    if prompt_data is None:
        return False
    return bool(getattr(prompt_data, "supervisor_notes_enabled", False))


def truncate_note(note: Optional[str]) -> Optional[str]:
    """Trim a note to something readable at a glance, or None if it's empty."""
    if not note:
        return None
    text = " ".join(note.split())
    if not text:
        return None
    return text[:MAX_NOTE_CHARS]


class SupervisorNotesService:
    """Runs the live-supervisor LLM per learner turn and ships any note."""

    def __init__(
        self,
        room: Any,
        llm_client: Any,
        *,
        room_id: str,
        language_label: str = "the language the learner is speaking",
        prompt_data: Any = None,
        is_paused: Optional[Callable[[], bool]] = None,
        language_code: Optional[str] = None,
        scenario_id: Optional[int] = None,
        timeout_s: Optional[float] = None,
        max_notes: Optional[int] = None,
        min_turn_gap: Optional[int] = None,
        window_turns: int = DEFAULT_WINDOW_TURNS,
    ) -> None:
        self._room = room
        self._room_id = room_id
        self._language_code = language_code
        self._scenario_id = scenario_id
        self._is_paused = is_paused

        self._timeout_s = (
            timeout_s
            if timeout_s is not None
            else float(
                getattr(settings, "SUPERVISOR_NOTES_TIMEOUT_S", DEFAULT_TIMEOUT_S)
            )
        )
        self._max_notes = (
            max_notes
            if max_notes is not None
            else int(
                getattr(settings, "SUPERVISOR_NOTES_MAX_PER_SESSION", DEFAULT_MAX_NOTES)
            )
        )
        self._min_turn_gap = (
            min_turn_gap
            if min_turn_gap is not None
            else int(
                getattr(settings, "SUPERVISOR_NOTES_MIN_TURN_GAP", DEFAULT_MIN_TURN_GAP)
            )
        )

        # Rolling conversation window: (role, text). Both roles, because a hint
        # about the learner only makes sense against what the client just said.
        self._window: Deque[Tuple[str, str]] = deque(maxlen=window_turns)
        self._tasks: Set[asyncio.Task] = set()

        self._notes_sent = 0
        self._seq = 0
        self._last_note_turn: Optional[int] = None
        self._sent_notes: list[str] = []
        self._misses = 0
        # Only one call in flight at a time: turns can commit faster than the
        # supervisor answers, and two overlapping calls would race on the caps.
        self._in_flight = False

        self._llm_client = llm_client
        llm_instance = getattr(llm_client, "llm_instance", llm_client)
        self._llm_model = (
            getattr(llm_instance, "model_name", None)
            or getattr(llm_instance, "model", None)
            or getattr(settings, "SUPERVISOR_NOTES_MODEL", "unknown")
        )
        self._llm_provider = (
            getattr(llm_client, "provider", None) or type(llm_instance).__name__
        )
        # include_raw=True keeps the raw AIMessage alongside the parsed verdict
        # so token usage can be emitted; fakes returning a bare verdict are also
        # accepted (see _invoke).
        try:
            self._structured = llm_instance.with_structured_output(
                SupervisorNoteVerdict, method="json_mode", include_raw=True
            )
        except TypeError:
            self._structured = llm_instance.with_structured_output(
                SupervisorNoteVerdict, method="json_mode"
            )

        self._system_prompt = load_and_format(
            "supervisor/live_note",
            prompt_data,
            LANGUAGE=language_label,
        )

    # ------------------------------------------------------------------
    # Conversation feed
    # ------------------------------------------------------------------

    def record_turn(self, role: str, text: str) -> None:
        """Add one committed utterance to the window. Never triggers a call."""
        cleaned = (text or "").strip()
        if not cleaned:
            return
        self._window.append((role, cleaned))

    def on_learner_turn_committed(self, turn_index: int) -> None:
        """The learner just finished speaking — consider sending a note.

        Fire-and-forget and tracked. Called from a synchronous LiveKit event
        handler, so it must not await and must not raise.
        """
        try:
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s committed — evaluating",
                self._room_id,
                self._scenario_id,
                turn_index,
            )
            if not self._should_consider(turn_index):
                return
            self._in_flight = True
            task = asyncio.create_task(self._run_guarded(turn_index))
            self._tasks.add(task)
            task.add_done_callback(self._tasks.discard)
        except Exception:  # noqa: BLE001 - a note must never break a turn
            self._in_flight = False
            logger.exception(
                "[supervisor] failed to schedule note for turn %s", turn_index
            )

    def _should_consider(self, turn_index: int) -> bool:
        """Code-enforced gates. The prompt argues for silence; this guarantees it."""
        if self._in_flight:
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s skipped — a note call "
                "is already in flight",
                self._room_id,
                self._scenario_id,
                turn_index,
            )
            return False
        if self._paused():
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s skipped — session paused",
                self._room_id,
                self._scenario_id,
                turn_index,
            )
            return False
        if self._notes_sent >= self._max_notes:
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s skipped — session cap "
                "of %d notes reached",
                self._room_id,
                self._scenario_id,
                turn_index,
                self._max_notes,
            )
            return False
        if (
            self._last_note_turn is not None
            and (turn_index - self._last_note_turn) < self._min_turn_gap
        ):
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s skipped — only %s "
                "turn(s) since the last note (min gap %d)",
                self._room_id,
                self._scenario_id,
                turn_index,
                turn_index - self._last_note_turn,
                self._min_turn_gap,
            )
            return False
        if not self._window:
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s skipped — no "
                "conversation window recorded yet",
                self._room_id,
                self._scenario_id,
                turn_index,
            )
            return False
        if not self._system_prompt:
            logger.warning(
                "[supervisor] room=%s scenario=%s no system prompt resolved — "
                "live notes are inert",
                self._room_id,
                self._scenario_id,
            )
            return False
        logger.info(
            "[supervisor] room=%s scenario=%s turn %s passed gates — invoking LLM",
            self._room_id,
            self._scenario_id,
            turn_index,
        )
        return True

    def _paused(self) -> bool:
        if self._is_paused is None:
            return False
        try:
            return bool(self._is_paused())
        except Exception:  # noqa: BLE001 - treat an unreadable clock as running
            logger.debug("[supervisor] pause check failed", exc_info=True)
            return False

    # ------------------------------------------------------------------
    # LLM call
    # ------------------------------------------------------------------

    async def _run_guarded(self, turn_index: int) -> None:
        started = time.perf_counter()
        try:
            verdict = await asyncio.wait_for(
                self._invoke(turn_index), timeout=self._timeout_s
            )
        except asyncio.TimeoutError:
            self._misses += 1
            logger.warning(
                "[supervisor] room=%s scenario=%s timed out after %.1fs on turn "
                "%s — no note (miss %d)",
                self._room_id,
                self._scenario_id,
                self._timeout_s,
                turn_index,
                self._misses,
            )
            return
        except asyncio.CancelledError:
            raise
        except Exception:
            self._misses += 1
            logger.exception(
                "[supervisor] room=%s scenario=%s failed on turn %s — no note "
                "(miss %d)",
                self._room_id,
                self._scenario_id,
                turn_index,
                self._misses,
            )
            return
        finally:
            self._in_flight = False

        latency_ms = round((time.perf_counter() - started) * 1000.0, 1)

        if verdict is None or not verdict.should_note:
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s — LLM chose silence "
                "(%.0fms)",
                self._room_id,
                self._scenario_id,
                turn_index,
                latency_ms,
            )
            return

        note = truncate_note(verdict.note)
        if not note:
            # should_note with nothing to say: treat as silence rather than
            # publishing an empty bubble to the learner.
            logger.info(
                "[supervisor] room=%s scenario=%s turn %s — should_note set but "
                "note was empty",
                self._room_id,
                self._scenario_id,
                turn_index,
            )
            return

        # Re-check the caps: the gates were evaluated before an LLM call that
        # may have taken seconds, and a note is only worth sending if it is
        # still wanted now.
        if self._notes_sent >= self._max_notes or self._paused():
            logger.debug(
                "[supervisor] turn %s — note dropped, no longer wanted", turn_index
            )
            return

        self._notes_sent += 1
        self._seq += 1
        self._last_note_turn = turn_index
        self._sent_notes.append(note)
        logger.info(
            "[supervisor] note %d/%d sent on turn %s (%.0fms): %s",
            self._notes_sent,
            self._max_notes,
            turn_index,
            latency_ms,
            note,
        )

        await self._publish(note, turn_index)
        self._enqueue(note, turn_index)

    async def _invoke(self, turn_index: int) -> Optional[SupervisorNoteVerdict]:
        messages = [
            SystemMessage(content=self._system_prompt),
            HumanMessage(content=self._build_user_prompt(turn_index)),
        ]
        result = await self._structured.ainvoke(messages)

        raw = None
        if isinstance(result, SupervisorNoteVerdict):
            verdict = result
        elif isinstance(result, dict):
            # include_raw=True shape: {"raw": AIMessage, "parsed": ..., ...}
            verdict = result.get("parsed")
            raw = result.get("raw")
            if verdict is None:
                raise ValueError(
                    f"Supervisor returned unparseable output: "
                    f"{result.get('parsing_error')}"
                )
        else:
            verdict = SupervisorNoteVerdict.model_validate(result)

        self._emit_usage(raw)
        return verdict

    def _emit_usage(self, raw: Any) -> None:
        """Best-effort token accounting; never blocks or raises."""
        try:
            usage = getattr(raw, "usage_metadata", None) or {}
            if not usage:
                return
            input_details = usage.get("input_token_details") or {}
            emit_llm_usage(
                self._room_id,
                self._llm_provider,
                str(self._llm_model),
                task=LLMTask.SUPERVISOR_NOTE.value,
                usage=(
                    int(usage.get("input_tokens", 0) or 0),
                    int(usage.get("output_tokens", 0) or 0),
                    int(usage.get("total_tokens", 0) or 0),
                    int(input_details.get("cache_read", 0) or 0),
                ),
                scenario_id=self._scenario_id,
            )
        except Exception:  # noqa: BLE001 - usage is telemetry, not the feature
            logger.debug("[supervisor] usage emit skipped", exc_info=True)

    def _build_user_prompt(self, turn_index: int) -> str:
        """Assemble the turn message manually — never str.format.

        The transcript can contain literal braces (a learner reads out a form,
        an address, anything), and formatting it would either crash or silently
        eat text. The Director's turn prompt does the same for the same reason.
        """
        lines = [f"Turn {turn_index}. The learner has just finished speaking."]

        if self._sent_notes:
            lines.append("")
            lines.append(
                "Notes you have already sent this session — do not repeat "
                "these, and do not send a note that only restates one:"
            )
            lines.extend(f"- {note}" for note in self._sent_notes)

        lines.append("")
        lines.append("Recent conversation (oldest first):")
        for role, text in self._window:
            speaker = "LEARNER" if role == "learner" else "CLIENT"
            lines.append(f"{speaker}: {text}")

        lines.append("")
        lines.append(
            "Does the learner need a note right now? Silence is usually right. "
            "Return your answer as the JSON verdict object described above."
        )
        return "\n".join(lines)

    # ------------------------------------------------------------------
    # Delivery
    # ------------------------------------------------------------------

    async def _publish(self, note: str, turn_index: int) -> None:
        """Push the note to the learner's browser over the data channel."""
        try:
            payload = {
                "type": SUPERVISOR_NOTE_TYPE,
                "note": note,
                "seq": self._seq,
                "turn_index": turn_index,
                "timestamp": get_current_iso_timestamp(),
            }
            await self._room.local_participant.publish_data(
                json.dumps(payload).encode("utf-8"),
                topic=SUPERVISOR_DATA_TOPIC,
                reliable=True,
            )
        except Exception as e:  # noqa: BLE001
            # A closing room is the ordinary case here (a note finishing just as
            # the learner hangs up), so this is not worth a stack trace.
            logger.debug(
                "[supervisor] publish failed (%s) — note still persisted",
                type(e).__name__,
            )

    def _enqueue(self, note: str, turn_index: int) -> None:
        """Ship the durable copy to Core, which the debrief later reads back."""
        try:
            message = CoreEventMessageType.create_supervisor_note(
                self._room_id,
                SupervisorNoteData(
                    note=note,
                    seq=self._seq,
                    turn_index=turn_index,
                    language=self._language_code,
                    env=settings.ENV.value,
                ),
            )
            from app.core.events.handlers import send_event_to_queue

            spawn_background_task(
                send_event_to_queue(message.model_dump_json()),
                name="supervisor-note-send",
                background_tasks=self._tasks,
            )
        except Exception:  # noqa: BLE001 - the learner already has the note
            logger.exception("[supervisor] failed to enqueue note for Core")

    # ------------------------------------------------------------------
    # Teardown
    # ------------------------------------------------------------------

    async def aclose(self) -> None:
        """Cancel anything still in flight. Safe to call more than once."""
        tasks = list(self._tasks)
        for task in tasks:
            task.cancel()
        if tasks:
            await asyncio.gather(*tasks, return_exceptions=True)
        self._tasks.clear()
        if self._notes_sent == 0 and self._misses > 0:
            # Every attempt this session failed or timed out — from the
            # learner's side this looks identical to a quiet, well-behaved
            # session (the tab just never got a hint), so nothing else would
            # ever surface it. This is the one signal that distinguishes "the
            # supervisor had nothing worth saying" from "the supervisor was
            # broken the whole time" — worth a WARNING (Slack-alerted when
            # SLACK_ALERTS_ENABLED) rather than burying it in per-turn logs.
            logger.warning(
                "[supervisor] room=%s scenario=%s closed with ZERO notes sent "
                "despite %d attempt(s) — every attempt failed or timed out",
                self._room_id,
                self._scenario_id,
                self._misses,
            )
        else:
            logger.info(
                "[supervisor] room=%s scenario=%s closed — %d note(s) sent, "
                "%d miss(es)",
                self._room_id,
                self._scenario_id,
                self._notes_sent,
                self._misses,
            )
