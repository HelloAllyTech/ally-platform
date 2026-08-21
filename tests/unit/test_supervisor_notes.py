"""Tests for live supervisor notes (in-session coaching hints).

The gates are the point of these tests. The prompt argues for silence, but the
caps that actually protect the learner mid-conversation are enforced in code, so
they need to hold regardless of what the LLM decides to say.
"""

import asyncio
import json
from types import SimpleNamespace

import pytest

from app.core.supervisor import service as supervisor_service
from app.core.supervisor.schemas import SupervisorNoteVerdict
from app.core.supervisor.service import SupervisorNotesService, truncate_note


def _scenario(supervisor_notes_enabled):
    """Minimal scenario stub exposing prompt_data.supervisor_notes_enabled."""
    return SimpleNamespace(
        prompt_data=SimpleNamespace(supervisor_notes_enabled=supervisor_notes_enabled)
    )


class _FakeStructured:
    """Stands in for llm.with_structured_output(...)."""

    def __init__(self, verdicts, delay=0.0):
        self._verdicts = list(verdicts)
        self._delay = delay
        self.calls = 0

    async def ainvoke(self, messages):
        self.calls += 1
        self.last_messages = messages
        if self._delay:
            await asyncio.sleep(self._delay)
        if not self._verdicts:
            return SupervisorNoteVerdict(should_note=False)
        return self._verdicts.pop(0)


class _FakeLLM:
    PROVIDER = "fake"
    model_name = "fake-model"

    def __init__(self, verdicts, delay=0.0):
        self.structured = _FakeStructured(verdicts, delay=delay)

    @property
    def llm_instance(self):
        return self

    @property
    def provider(self):
        return self.PROVIDER

    def with_structured_output(self, schema, method=None, include_raw=False):
        return self.structured


class _FakeParticipant:
    def __init__(self):
        self.published = []

    async def publish_data(self, payload, topic=None, reliable=True):
        self.published.append((json.loads(payload.decode("utf-8")), topic))


class _FakeRoom:
    def __init__(self):
        self.local_participant = _FakeParticipant()


def _service(verdicts, monkeypatch, delay=0.0, **kwargs):
    """A service wired to a fake room and LLM, with SQS emission stubbed out."""
    monkeypatch.setattr(
        supervisor_service, "load_and_format", lambda *a, **k: "SYSTEM PROMPT"
    )
    room = _FakeRoom()
    svc = SupervisorNotesService(
        room,
        _FakeLLM(verdicts, delay=delay),
        room_id="ss_room-1",
        language_label="Tamil (India)",
        language_code="ta-IN",
        **kwargs,
    )
    # The durable copy goes to SQS; capture it instead of sending.
    svc._enqueued = []
    svc._enqueue = lambda note, turn_index: svc._enqueued.append((note, turn_index))
    return svc, room


async def _turn(svc, turn_index, learner="I see. What about work?"):
    """Feed one learner turn and let the detached note task finish."""
    svc.record_turn("client", "It has been hard since the layoff.")
    svc.record_turn("learner", learner)
    svc.on_learner_turn_committed(turn_index)
    for _ in range(10):
        await asyncio.sleep(0)
        if not svc._tasks:
            break
    await asyncio.gather(*list(svc._tasks), return_exceptions=True)


class TestIsSupervisorNotesEnabled:
    """Two gates: the global kill-switch AND the per-simulation opt-in."""

    @pytest.mark.unit
    def test_enabled_when_both_on(self, monkeypatch):
        monkeypatch.setattr(
            supervisor_service.settings, "SUPERVISOR_NOTES_ENABLED", True
        )
        assert supervisor_service.is_supervisor_notes_enabled(_scenario(True)) is True

    @pytest.mark.unit
    def test_disabled_by_default_when_scenario_opt_out(self, monkeypatch):
        """Global on but the per-sim opt-in is off (the default) → no notes."""
        monkeypatch.setattr(
            supervisor_service.settings, "SUPERVISOR_NOTES_ENABLED", True
        )
        assert supervisor_service.is_supervisor_notes_enabled(_scenario(False)) is False

    @pytest.mark.unit
    def test_disabled_when_global_off(self, monkeypatch):
        """Global kill-switch wins even when the per-sim toggle is on."""
        monkeypatch.setattr(
            supervisor_service.settings, "SUPERVISOR_NOTES_ENABLED", False
        )
        assert supervisor_service.is_supervisor_notes_enabled(_scenario(True)) is False

    @pytest.mark.unit
    def test_disabled_when_no_scenario_or_prompt_data(self, monkeypatch):
        monkeypatch.setattr(
            supervisor_service.settings, "SUPERVISOR_NOTES_ENABLED", True
        )
        assert supervisor_service.is_supervisor_notes_enabled(None) is False
        assert (
            supervisor_service.is_supervisor_notes_enabled(SimpleNamespace()) is False
        )


class TestTruncateNote:
    @pytest.mark.unit
    def test_empty_becomes_none(self):
        assert truncate_note(None) is None
        assert truncate_note("   ") is None

    @pytest.mark.unit
    def test_whitespace_is_collapsed(self):
        assert truncate_note("  slow   down\nhere ") == "slow down here"

    @pytest.mark.unit
    def test_long_note_is_capped(self):
        assert len(truncate_note("x" * 500)) == supervisor_service.MAX_NOTE_CHARS


class TestNoteDelivery:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_note_is_published_and_persisted(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Stay with the fear.")],
            monkeypatch,
        )
        await _turn(svc, 1)

        payload, topic = room.local_participant.published[0]
        assert topic == supervisor_service.SUPERVISOR_DATA_TOPIC
        assert payload["type"] == "supervisor.note"
        assert payload["note"] == "Stay with the fear."
        assert payload["seq"] == 1
        assert payload["turn_index"] == 1
        # The durable copy carries the same seq, which is Core's idempotency key.
        assert svc._enqueued == [("Stay with the fear.", 1)]

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_silence_publishes_nothing(self, monkeypatch):
        svc, room = _service([SupervisorNoteVerdict(should_note=False)], monkeypatch)
        await _turn(svc, 1)

        assert room.local_participant.published == []
        assert svc._enqueued == []

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_should_note_with_empty_text_is_treated_as_silence(self, monkeypatch):
        # Never publish an empty bubble to a learner mid-conversation.
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="   ")], monkeypatch
        )
        await _turn(svc, 1)

        assert room.local_participant.published == []

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_seq_increments_across_notes(self, monkeypatch):
        svc, room = _service(
            [
                SupervisorNoteVerdict(should_note=True, note="First."),
                SupervisorNoteVerdict(should_note=True, note="Second."),
            ],
            monkeypatch,
            min_turn_gap=0,
        )
        await _turn(svc, 1)
        await _turn(svc, 2)

        assert [p["seq"] for p, _ in room.local_participant.published] == [1, 2]


class TestGates:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_session_cap_stops_further_notes(self, monkeypatch):
        svc, room = _service(
            [
                SupervisorNoteVerdict(should_note=True, note=f"Note {i}")
                for i in range(5)
            ],
            monkeypatch,
            max_notes=2,
            min_turn_gap=0,
        )
        for turn in range(1, 5):
            await _turn(svc, turn)

        assert len(room.local_participant.published) == 2

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_min_turn_gap_is_enforced(self, monkeypatch):
        svc, room = _service(
            [
                SupervisorNoteVerdict(should_note=True, note=f"Note {i}")
                for i in range(5)
            ],
            monkeypatch,
            min_turn_gap=3,
        )
        # Turn 1 notes; turns 2 and 3 are inside the gap; turn 4 is allowed.
        for turn in range(1, 5):
            await _turn(svc, turn)

        assert [p["turn_index"] for p, _ in room.local_participant.published] == [1, 4]

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_paused_session_produces_no_notes(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Anything.")],
            monkeypatch,
            is_paused=lambda: True,
        )
        await _turn(svc, 1)

        assert room.local_participant.published == []
        assert svc._llm_client.structured.calls == 0

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_unreadable_pause_check_is_treated_as_running(self, monkeypatch):
        def _boom():
            raise RuntimeError("no clock")

        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Still coaching.")],
            monkeypatch,
            is_paused=_boom,
        )
        await _turn(svc, 1)

        assert len(room.local_participant.published) == 1

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_second_turn_is_skipped_while_a_call_is_in_flight(self, monkeypatch):
        svc, _ = _service(
            [
                SupervisorNoteVerdict(should_note=True, note="First."),
                SupervisorNoteVerdict(should_note=True, note="Second."),
            ],
            monkeypatch,
            delay=0.05,
            min_turn_gap=0,
        )
        svc.record_turn("learner", "One.")
        svc.on_learner_turn_committed(1)
        # Overlapping turns must not race the caps.
        svc.on_learner_turn_committed(2)
        await asyncio.gather(*list(svc._tasks), return_exceptions=True)

        assert svc._llm_client.structured.calls == 1

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_no_note_before_any_conversation(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Too early.")], monkeypatch
        )
        svc.on_learner_turn_committed(1)
        await asyncio.gather(*list(svc._tasks), return_exceptions=True)

        assert room.local_participant.published == []


class TestFailuresNeverBreakTheSession:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_timeout_is_a_miss_not_a_raise(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Too slow.")],
            monkeypatch,
            delay=0.2,
            timeout_s=0.01,
        )
        await _turn(svc, 1)

        assert room.local_participant.published == []
        assert svc._misses == 1

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_llm_exception_is_a_miss_not_a_raise(self, monkeypatch):
        svc, room = _service([], monkeypatch)

        async def _explode(messages):
            raise RuntimeError("provider down")

        svc._structured.ainvoke = _explode
        await _turn(svc, 1)

        assert room.local_participant.published == []
        assert svc._misses == 1

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_publish_failure_still_persists_the_note(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Keep going.")], monkeypatch
        )

        async def _explode(payload, topic=None, reliable=True):
            raise RuntimeError("room closed")

        room.local_participant.publish_data = _explode
        await _turn(svc, 1)

        # The learner missed it, but the debrief must still know it was sent.
        assert svc._enqueued == [("Keep going.", 1)]

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_aclose_cancels_in_flight_work(self, monkeypatch):
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Late.")],
            monkeypatch,
            delay=1.0,
        )
        svc.record_turn("learner", "Something.")
        svc.on_learner_turn_committed(1)
        await asyncio.sleep(0)
        await svc.aclose()

        assert svc._tasks == set()
        assert room.local_participant.published == []


class TestPromptAssembly:
    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_transcript_braces_do_not_break_the_prompt(self, monkeypatch):
        # A learner can read out anything, braces included; the turn message is
        # assembled manually for exactly this reason.
        svc, room = _service(
            [SupervisorNoteVerdict(should_note=True, note="Fine.")], monkeypatch
        )
        await _turn(svc, 1, learner="They wrote {name} on the form {again}")

        user_message = svc._llm_client.structured.last_messages[1].content
        assert "{name}" in user_message
        assert len(room.local_participant.published) == 1

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_previous_notes_are_shown_back_to_the_model(self, monkeypatch):
        svc, _ = _service(
            [
                SupervisorNoteVerdict(should_note=True, note="Slow down."),
                SupervisorNoteVerdict(should_note=False),
            ],
            monkeypatch,
            min_turn_gap=0,
        )
        await _turn(svc, 1)
        await _turn(svc, 2)

        user_message = svc._llm_client.structured.last_messages[1].content
        assert "Slow down." in user_message

    @pytest.mark.unit
    @pytest.mark.asyncio
    async def test_both_speakers_are_in_the_window(self, monkeypatch):
        svc, _ = _service([SupervisorNoteVerdict(should_note=False)], monkeypatch)
        await _turn(svc, 1)

        user_message = svc._llm_client.structured.last_messages[1].content
        assert "CLIENT: It has been hard since the layoff." in user_message
        assert "LEARNER: I see. What about work?" in user_message
