"""One learner utterance in, what Ally says out — by way of ally-be.

``GuideVoiceTurns.speak`` is what ``GuideVoiceAgent.llm_node`` iterates: it
posts the final transcript to ``POST /v1/guide/voice/turns`` and yields the
text to speak as ally-be streams it. No model runs here.

What each outcome sounds like:

* ``delta`` frames are spoken as they arrive; a fixed crisis message is fenced
  off with flushes so the TTS node can pace it (see ``crisis.py``).
* ``card_hint`` frames are spoken in line, padded so they never fuse with the
  words around them.
* ``turn_in_progress`` says nothing. It is retried briefly first, with a fresh
  ``clientTurnId``: right after a barge-in, the turn the learner spoke over can
  still be unwinding in ally-be, and dropping the words that interrupted it
  would be the worst possible answer to them. The retry is safe because a
  turn refused at the lock never ran.
* ``guide_disabled`` and a 401 end the session: a fixed line, then the worker
  leaves (``on_leave``).
* Anything else — another failure code, ally-be unreachable, a broken stream —
  is "Sorry, I lost that. Could you say it again?". Retrying the stream would
  not help: ally-be refuses a repeated ``clientTurnId`` as a duplicate, and a
  new one could run the turn twice.

Closing the generator early (LiveKit cancels it on a barge-in) closes the HTTP
stream, which is what cancels the turn in ally-be.
"""

from __future__ import annotations

import asyncio
import secrets
import time
import uuid
from contextlib import aclosing
from typing import AsyncIterator, Callable, Optional, Union

from livekit.agents import FlushSentinel

from app.core.guide.client import (
    GuideBackendClient,
    GuideBackendError,
    GuideSessionEnded,
)
from app.core.guide.contract import (
    GuideVoiceFrameCardHint,
    GuideVoiceFrameDelta,
    GuideVoiceFrameDone,
    GuideVoiceFrameError,
    GuideVoiceTurnRequest,
)
from app.core.guide.crisis import DeliveryState, is_fixed_crisis_text
from app.core.guide.ledger import SpokenReplyLedger
from app.core.guide.lines import LeaveReason, lost_that_line, slow_turn_line
from app.core.logger import get_logger

logger = get_logger(__name__)

#: ally-be's limits (GuideVoiceTurnDto).
MAX_TEXT_CHARS = 2000
MAX_CLIENT_TURN_ID_CHARS = 64

Spoken = Union[str, FlushSentinel]


def new_client_turn_id() -> str:
    return f"gv-{uuid.uuid4().hex}"


def new_traceparent() -> str:
    """A W3C trace context for one turn (plan §7.9). Sent as ``traceparent``
    and logged with the turn, so the turn can be followed into ally-be once
    its voice controller reads the header (the text path already does)."""
    return f"00-{secrets.token_hex(16)}-{secrets.token_hex(8)}-01"


def prepare_text(text: Optional[str]) -> str:
    """The transcript as ally-be accepts it: trimmed, ≤ 2,000 characters
    (cut at a word boundary — about five minutes of speech)."""
    cleaned = " ".join((text or "").split())
    if len(cleaned) <= MAX_TEXT_CHARS:
        return cleaned
    cut = cleaned[:MAX_TEXT_CHARS]
    space = cut.rfind(" ")
    return cut[:space] if space > MAX_TEXT_CHARS // 2 else cut


def _padded(hint: str, spoken_so_far: str) -> str:
    text = hint.strip()
    if spoken_so_far and not spoken_so_far[-1].isspace():
        text = " " + text
    return text + " "


class GuideVoiceTurns:
    """Turns for one voice session. Not reentrant: one reply at a time."""

    def __init__(
        self,
        client: GuideBackendClient,
        *,
        token: str,
        language: str,
        ledger: SpokenReplyLedger,
        delivery: DeliveryState,
        on_leave: Callable[[LeaveReason], None],
        busy_retries: int = 2,
        busy_retry_delay_s: float = 0.4,
        slow_turn_after_s: float = 8.0,
        client_turn_id: Callable[[], str] = new_client_turn_id,
        traceparent: Callable[[], str] = new_traceparent,
    ) -> None:
        self._client = client
        self._token = token
        self._language = language
        self._ledger = ledger
        self._delivery = delivery
        self._on_leave = on_leave
        self._busy_retries = max(0, busy_retries)
        self._busy_retry_delay_s = busy_retry_delay_s
        self._slow_turn_after_s = slow_turn_after_s
        self._client_turn_id = client_turn_id
        self._traceparent = traceparent
        self._closed = False

    @property
    def closed(self) -> bool:
        return self._closed

    def close(self) -> None:
        """Take no more turns (the worker is leaving)."""
        self._closed = True

    def _leave(self, reason: LeaveReason) -> None:
        self._closed = True
        self._on_leave(reason)

    async def speak(self, text: Optional[str]) -> AsyncIterator[Spoken]:
        utterance = prepare_text(text)
        if self._closed or not utterance:
            return
        self._ledger.begin_reply()
        self._delivery.start_reply()
        interruption = self._ledger.take_pending()
        spoken = ""
        outcome = "no_frames"
        started = time.monotonic()
        first_frame_ms: Optional[float] = None
        trace = ""
        try:
            for attempt in range(self._busy_retries + 1):
                request = GuideVoiceTurnRequest(
                    token=self._token,
                    client_turn_id=self._client_turn_id()[:MAX_CLIENT_TURN_ID_CHARS],
                    text=utterance,
                    language=self._language,
                    interrupted_turn_id=interruption.turn_id if interruption else None,
                    spoken_chars=interruption.spoken_chars if interruption else None,
                )
                traceparent = self._traceparent()
                trace = traceparent.split("-")[1]
                outcome = "no_frames"
                slow_line_after = self._slow_turn_after_s if not spoken else 0.0
                async with aclosing(
                    self._attempt(request, traceparent, slow_line_after)
                ) as items:
                    async for frame in items:
                        if frame is _SLOW_TURN:
                            line = slow_turn_line(self._language)
                            self._ledger.note_other_text(line)
                            spoken += line
                            yield line
                            continue
                        if first_frame_ms is None:
                            first_frame_ms = (time.monotonic() - started) * 1000
                        if isinstance(frame, GuideVoiceFrameDelta):
                            if not frame.text:
                                continue
                            outcome = "streaming"
                            if is_fixed_crisis_text(frame.text):
                                # Fence the crisis message into its own TTS
                                # segment so the TTS node can pace it.
                                self._delivery.crisis = True
                                self._ledger.note_reply_text(
                                    frame.text, supersedes_earlier=True
                                )
                                yield FlushSentinel()
                                spoken += frame.text
                                yield frame.text
                                yield FlushSentinel()
                                continue
                            self._ledger.note_reply_text(frame.text)
                            spoken += frame.text
                            yield frame.text
                        elif isinstance(frame, GuideVoiceFrameCardHint):
                            if not frame.text.strip():
                                continue
                            hint = _padded(frame.text, spoken)
                            self._ledger.note_other_text(hint)
                            spoken += hint
                            yield hint
                        elif isinstance(frame, GuideVoiceFrameDone):
                            self._ledger.note_done(frame.turn_id)
                            outcome = "done"
                        elif isinstance(frame, GuideVoiceFrameError):
                            outcome = frame.code
                            break
                if outcome != "turn_in_progress" or attempt >= self._busy_retries:
                    break
                await asyncio.sleep(self._busy_retry_delay_s)
        except GuideSessionEnded:
            outcome = "session_ended"
        except GuideBackendError as exc:
            logger.warning("[GUIDE] voice turn failed: %s (%s)", exc, exc.code)
            outcome = "backend_error"
        finally:
            if outcome != "done":
                # ally-be didn't (verifiably) act on it: carry it to the next turn.
                self._ledger.restore_pending(interruption)
            logger.info(
                "[GUIDE_TURN] outcome=%s first_frame_ms=%s total_ms=%.0f "
                "spoken_chars=%d trace=%s",
                outcome,
                f"{first_frame_ms:.0f}" if first_frame_ms is not None else "-",
                (time.monotonic() - started) * 1000,
                len(spoken),
                trace or "-",
            )

        if outcome in ("done", "streaming", "turn_in_progress"):
            # "streaming" with no done frame: ally-be ended the stream early;
            # what was said stands.
            return
        if outcome == "session_ended":
            self._leave(LeaveReason.SESSION_ENDED)
            return
        if outcome == "guide_disabled":
            self._leave(LeaveReason.VOICE_OFF)
            return
        line = lost_that_line(self._language)
        self._ledger.note_other_text(line)
        yield _padded(line, spoken) if spoken else line

    async def _attempt(
        self,
        request: GuideVoiceTurnRequest,
        traceparent: str,
        slow_line_after_s: float,
    ) -> AsyncIterator[object]:
        """One request's frames, with ``_SLOW_TURN`` in front of them if ally-be
        stays silent for ``slow_line_after_s`` (0 = never).

        The HTTP stream is read by a task of its own and handed over through a
        queue, so the wait for the first frame can time out without touching
        the stream — and closing this generator cancels that task, which
        closes the connection (the barge-in signal) inside the task that
        opened it.
        """
        queue: asyncio.Queue = asyncio.Queue()
        reader = asyncio.create_task(self._read(request, traceparent, queue))
        try:
            waiting_for_first = slow_line_after_s > 0
            while True:
                if waiting_for_first:
                    waiting_for_first = False
                    try:
                        item = await asyncio.wait_for(
                            queue.get(), timeout=slow_line_after_s
                        )
                    except asyncio.TimeoutError:
                        yield _SLOW_TURN
                        item = await queue.get()
                else:
                    item = await queue.get()
                if item is _END:
                    return
                if isinstance(item, BaseException):
                    raise item
                yield item
        finally:
            if not reader.done():
                reader.cancel()
            try:
                await reader
            except (asyncio.CancelledError, Exception):  # noqa: BLE001
                pass

    async def _read(
        self,
        request: GuideVoiceTurnRequest,
        traceparent: str,
        queue: asyncio.Queue,
    ) -> None:
        try:
            frames = self._client.stream_turn(request, traceparent=traceparent)
            async with aclosing(frames):
                async for frame in frames:
                    queue.put_nowait(frame)
        except (GuideSessionEnded, GuideBackendError) as exc:
            queue.put_nowait(exc)
        except Exception as exc:  # noqa: BLE001 - a bug here must not go silent
            logger.exception("[GUIDE] voice turn stream crashed")
            queue.put_nowait(GuideBackendError(repr(exc), code="internal_error"))
        finally:
            queue.put_nowait(_END)


_SLOW_TURN = object()
_END = object()
