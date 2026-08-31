"""An unrecoverable TTS error must not leave the learner with dead air.

WHY THIS EXISTS
---------------
Reported from a course roleplay: the actor went silent for one turn, yet its
dialogue for that turn was there in the transcript afterwards, and the rest of
the session carried on normally.

That is exactly what LiveKit does today. In ``agent_activity`` the LLM's text
stream is teed into TWO independent consumers — one synthesizes audio, the
other accumulates the transcript and unconditionally commits it to the chat
context. The synthesis task's outcome is awaited through
``wait_if_not_interrupted``, i.e. ``asyncio.gather(..., return_exceptions=True)``,
so a TTS failure (after the plugin's own retries are exhausted) is captured and
thrown away — the transcript still commits. ``AgentSession._on_error`` only
closes the session after FOUR consecutive unrecoverable TTS errors, and that
counter resets every time the agent next reaches the "speaking" state. So an
isolated failure is invisible everywhere except one log line.

The complementary "four in a row closed the session" case is already handled by
the ``session.on("close")`` handler in ``_register_callbacks``. These tests
cover the common one it cannot see: a single failure that never accumulates.
"""

import asyncio
import json
import types

import pytest
from livekit.agents.tts import TTSError
from livekit.rtc import EventEmitter

import app.worker as worker
from app.core.fallback_lines import tts_failure_fallback_line


class _RecordingLocalParticipant:
    def __init__(self):
        self.packets = []

    async def publish_data(self, data, reliable=True):
        self.packets.append(json.loads(bytes(data).decode("utf-8")))


class _RecordingSession:
    """Stands in for AgentSession: records say() the way the learner hears it."""

    def __init__(self, say_error=None):
        self.said = []
        self._say_error = say_error

    def say(self, text, allow_interruptions=True):
        if self._say_error is not None:
            raise self._say_error
        self.said.append(text)
        return types.SimpleNamespace()


def _tts_error(recoverable=False, label="tts.stream"):
    return TTSError(
        timestamp=0.0,
        label=label,
        error=RuntimeError("synthesis failed"),
        recoverable=recoverable,
    )


def _make_worker(language_code="en-IN", say_error=None):
    room = types.SimpleNamespace(
        name="room-1", local_participant=_RecordingLocalParticipant()
    )
    ctx = types.SimpleNamespace(room=room)
    w = worker.AgentWorker(ctx)
    w.session = _RecordingSession(say_error=say_error)
    w.scenario = types.SimpleNamespace(
        language_config=types.SimpleNamespace(language_code=language_code)
    )
    # The exact object handed to AgentSession(tts=...) — the one the library's
    # own _on_error listens on.
    w._session_tts_instance = EventEmitter()
    return w


async def _drain():
    """Let the handler's background task run to completion."""
    for _ in range(10):
        await asyncio.sleep(0)


@pytest.mark.unit
async def test_unrecoverable_tts_error_speaks_a_fallback_line():
    """The turn lost its audio — the learner must hear something, not silence."""
    w = _make_worker(language_code="ta-IN")
    w._register_tts_error_fallback()

    w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()

    assert w.session.said == [tts_failure_fallback_line("ta-IN")]


@pytest.mark.unit
async def test_unrecoverable_tts_error_signals_a_non_fatal_fault():
    """The client is told the session is degraded, without tearing it down."""
    w = _make_worker()
    w._register_tts_error_fallback()

    w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()

    packets = w.ctx.room.local_participant.packets
    assert packets == [
        {
            "type": worker.CTRL_SESSION_FAULT,
            "reason": "tts_synthesis_failed",
            "fatal": False,
        }
    ]


@pytest.mark.unit
async def test_recoverable_tts_error_is_left_alone():
    """The plugin retries these itself; the audio still lands."""
    w = _make_worker()
    w._register_tts_error_fallback()

    w._session_tts_instance.emit("error", _tts_error(recoverable=True))
    await _drain()

    assert w.session.said == []
    assert w.ctx.room.local_participant.packets == []


@pytest.mark.unit
async def test_repeated_failures_speak_at_most_one_line_per_cooldown():
    """A provider outage must not turn into a cascade of failing say() calls.

    Each fallback line is itself synthesized on the same broken instance, so an
    unthrottled retry would both spam the learner and drive the session's
    consecutive-error count toward the close threshold.
    """
    w = _make_worker()
    w._register_tts_error_fallback()

    for _ in range(4):
        w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()

    assert len(w.session.said) == 1


@pytest.mark.unit
async def test_cooldown_expiry_allows_a_later_turn_to_recover(monkeypatch):
    """A failure on a much later turn is a new incident, not a repeat."""
    w = _make_worker()
    w._register_tts_error_fallback()

    w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()
    # Pretend the first fallback happened a full cooldown ago.
    w._last_tts_fallback_at -= worker.TTS_FAILURE_FALLBACK_COOLDOWN_S + 1
    w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()

    assert len(w.session.said) == 2


@pytest.mark.unit
async def test_handler_never_breaks_the_session_when_say_fails():
    """say() raises on a closing session — that must stay contained."""
    w = _make_worker(say_error=RuntimeError("AgentSession is closing"))
    w._register_tts_error_fallback()

    # Emitting must not propagate, and the background task must not die dirty.
    w._session_tts_instance.emit("error", _tts_error(recoverable=False))
    await _drain()

    assert w.session.said == []
    # The client is still told the session is degraded.
    assert w.ctx.room.local_participant.packets


@pytest.mark.unit
async def test_missing_tts_instance_is_a_no_op():
    """Registration must never be able to fail session startup."""
    w = _make_worker()
    w._session_tts_instance = None

    w._register_tts_error_fallback()  # must not raise


@pytest.mark.unit
def test_create_session_records_the_instance_handed_to_agent_session(monkeypatch):
    """The listener must attach to the SAME object AgentSession got.

    Provider clients build ``tts_instance`` lazily and cache it, but that is a
    per-client convention (see create_clip_tts); binding to the captured object
    removes the assumption entirely.
    """
    captured = {}

    def _fake_agent_session(*, stt, tts, vad, turn_detection, **kwargs):
        captured["tts"] = tts
        return object()

    monkeypatch.setattr(worker, "AgentSession", _fake_agent_session)

    tts_instance = EventEmitter()
    ctx = types.SimpleNamespace(
        room=types.SimpleNamespace(name="room-1"),
        proc=types.SimpleNamespace(userdata={}),
    )
    w = worker.AgentWorker(ctx)
    w.stt_client = types.SimpleNamespace(stt_instance=object())
    w.tts_client = types.SimpleNamespace(tts_instance=tts_instance)

    w._create_session()

    assert captured["tts"] is tts_instance
    assert w._session_tts_instance is tts_instance
