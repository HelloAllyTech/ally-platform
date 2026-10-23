"""Barge-in and simulation-state instrumentation on the turn-metrics record.

These two signals feed the Weak Performing Metrics dashboard. Both were columns
or fields that existed and were never written, so the tests here assert the
WRITE happens and — for barge-in — that it lands on the intended turn, which is
the part that is easy to get subtly wrong.
"""

from unittest.mock import MagicMock

import pytest

# `app.core.events.handlers` cannot be imported first: app.core.graph.nodes
# imports `send_event_to_ui` from it at module level, so importing handlers
# before nodes hits a pre-existing circular import. Importing nodes first
# settles the cycle. Without this the module passes or fails purely on
# collection order, which pytest-randomly varies run to run.
import app.core.graph.nodes  # noqa: F401  (import-order fix, not a dependency)
from app.core.events import handlers
from app.core.metrics import turn_metrics as tm


@pytest.fixture(autouse=True)
def _reset_state():
    tm._turns.clear()
    tm._turn_counters.clear()
    yield
    tm._turns.clear()
    tm._turn_counters.clear()


class _FakeAudioOutput:
    """Captures the `playback_finished` listener the handler registers."""

    def __init__(self):
        self.listener = None

    def on(self, event_name):
        def _decorator(fn):
            if event_name == "playback_finished":
                self.listener = fn
            return fn

        return _decorator


class _FakeSession:
    def __init__(self):
        self.output = MagicMock()
        self.output.audio = _FakeAudioOutput()


def _playback_event(interrupted: bool):
    ev = MagicMock()
    ev.interrupted = interrupted
    return ev


def _setup(room_id="room-1"):
    session = _FakeSession()
    handlers.setup_interruption_detection(session, room_id)
    assert session.output.audio.listener is not None, "listener was not registered"
    return session.output.audio.listener


# --------------------------------------------------------------------------
# Barge-in
# --------------------------------------------------------------------------


def test_interruption_is_recorded_on_the_inflight_turn():
    listener = _setup()
    listener(_playback_event(interrupted=True))

    # `record` lazily creates the in-flight turn, so the barge-in is captured
    # even though the learner has not finished speaking yet.
    tm.note_user_speech_end("room-1", 100.0)
    rec = tm.finalize("room-1", 101.0)

    assert rec is not None
    assert rec["interrupted"] is True


def test_uninterrupted_playback_records_nothing():
    listener = _setup()
    listener(_playback_event(interrupted=False))

    tm.note_user_speech_end("room-1", 100.0)
    rec = tm.finalize("room-1", 101.0)

    # Absent rather than False: the backend defaults it, and a turn that simply
    # played out should not be distinguishable from one never instrumented.
    assert "interrupted" not in rec


def test_barge_in_does_not_leak_across_rooms():
    listener = _setup("room-1")
    listener(_playback_event(interrupted=True))

    tm.note_user_speech_end("room-2", 100.0)
    other = tm.finalize("room-2", 101.0)

    assert "interrupted" not in other


def test_missing_room_id_still_arms_the_scenario_event():
    """Older call sites pass no room. The flag must still be set, and no
    barge-in may be attributed to a guessed room."""
    session = _FakeSession()
    handlers.setup_interruption_detection(session)
    session.output.audio.listener(_playback_event(interrupted=True))

    from app.core.events.event_types.interruption.interruption_event import (
        get_interruption_detected,
        set_interruption_detected,
    )

    assert get_interruption_detected() is True
    set_interruption_detected(False)
    assert tm._turns == {}


def test_interruption_survives_alongside_other_recorded_fields():
    listener = _setup()
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", llm_response_ms=250, llm_model="gpt-4o-mini")
    listener(_playback_event(interrupted=True))

    rec = tm.finalize("room-1", 101.0)
    assert rec["interrupted"] is True
    assert rec["llm_response_ms"] == 250
    assert rec["llm_model"] == "gpt-4o-mini"


# --------------------------------------------------------------------------
# Simulation state
# --------------------------------------------------------------------------


def test_state_metadata_merges_rather_than_overwrites():
    """The state writer shares `metadata` with retrieval and generation call
    sites. Last-writer-wins here would silently erase the glossary keys."""
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", metadata={"knowledgeRetrievalReused": True})
    tm.record(
        "room-1",
        metadata={
            "stateId": "2",
            "stateIndex": 1,
            "stateCount": 3,
            "stateIsTerminal": False,
            "stateScore": 12,
        },
    )

    rec = tm.finalize("room-1", 101.0)
    meta = rec["metadata"]
    assert meta["knowledgeRetrievalReused"] is True
    assert meta["stateId"] == "2"
    assert meta["stateIndex"] == 1
    assert meta["stateCount"] == 3
    assert meta["stateIsTerminal"] is False
    assert meta["stateScore"] == 12


def test_null_state_id_is_preserved_inside_metadata():
    """`record` drops None VALUES, but a None nested inside the metadata dict
    must survive: "no state resolved this turn" and "this build does not report
    state" are different readings downstream."""
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", metadata={"stateId": None, "stateCount": 3})

    rec = tm.finalize("room-1", 101.0)
    assert "stateId" in rec["metadata"]
    assert rec["metadata"]["stateId"] is None
    assert rec["metadata"]["stateCount"] == 3
