"""Turn-metrics attribution: which turn a timing lands on.

Both cases here were live defects found by reading production rows against the
code, and both corrupt the latency analytics quietly rather than failing:

1. LiveKit emits LLMMetrics / TTSMetrics only once the stream COMPLETES, which
   is after the agent began speaking — after finalize() closed the turn. The
   accumulator created a fresh turn for the late value and the NEXT
   note_user_speech_end adopted it, so turn N's time-to-first-token was
   reported as turn N+1's. Signature in production: llmTtftMs null 27.2% of the
   time at turn 0 against 7.2% at turn 5.

2. UserState is speaking|listening|away, and the handler treated every
   non-speaking transition as a speech end. listening->away (LiveKit's
   user_away_timeout, 15s, which we do not override) restarted the latency
   window mid-turn.
"""

import types

import pytest

import app.core.graph.nodes  # noqa: F401  (settles a pre-existing import cycle)
from app.core.events import handlers
from app.core.metrics import turn_metrics as tm


@pytest.fixture(autouse=True)
def _reset_state():
    for d in (tm._turns, tm._turn_counters, tm._closed):
        d.clear()
    yield
    for d in (tm._turns, tm._turn_counters, tm._closed):
        d.clear()


# --------------------------------------------------------------------------
# 1. Late framework metrics must not shift one turn forward
# --------------------------------------------------------------------------


def test_ttft_arriving_after_finalize_does_not_land_on_the_next_turn():
    tm.note_user_speech_end("room-1", 100.0)
    first = tm.finalize("room-1", 105.0)
    assert first is not None

    # LiveKit's LLMMetrics for the turn that just spoke, arriving late.
    tm.record("room-1", llm_ttft_ms=4870)

    tm.note_user_speech_end("room-1", 200.0)
    second = tm.finalize("room-1", 201.0)

    assert second is not None
    assert "llm_ttft_ms" not in second, "previous turn's TTFT leaked forward"
    assert second["response_latency_ms"] == 1000


def test_ttfb_arriving_after_finalize_does_not_land_on_the_next_turn():
    tm.note_user_speech_end("room-1", 100.0)
    tm.finalize("room-1", 105.0)
    tm.record("room-1", tts_ttfb_ms=961)

    tm.note_user_speech_end("room-1", 200.0)
    assert "tts_ttfb_ms" not in tm.finalize("room-1", 201.0)


def test_ttft_still_lands_on_its_own_turn_when_it_arrives_in_time():
    # The fix must not cost us the metric in the normal case.
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", llm_ttft_ms=800)
    rec = tm.finalize("room-1", 102.0)

    assert rec["llm_ttft_ms"] == 800


def test_app_stage_timings_still_create_a_turn_before_endpointing():
    # Preemptive generation runs a graph node before the learner finishes
    # speaking; those timings belong to the turn about to begin and must still
    # be captured. This is why the fix is scoped to the framework fields.
    tm.note_user_speech_end("room-1", 100.0)
    tm.finalize("room-1", 105.0)

    tm.record("room-1", orchestration_ms=42)
    tm.note_user_speech_end("room-1", 200.0)
    rec = tm.finalize("room-1", 201.0)

    assert rec["orchestration_ms"] == 42


def test_a_new_turn_reopens_the_room_for_framework_metrics():
    tm.note_user_speech_end("room-1", 100.0)
    tm.finalize("room-1", 105.0)
    tm.record("room-1", llm_ttft_ms=1)  # dropped: turn already closed
    tm.note_user_speech_end("room-1", 200.0)
    tm.record("room-1", llm_ttft_ms=777)  # kept: new turn is open

    assert tm.finalize("room-1", 201.0)["llm_ttft_ms"] == 777


def test_discard_clears_the_closed_marker():
    tm.note_user_speech_end("room-1", 100.0)
    tm.finalize("room-1", 105.0)
    tm.discard("room-1")

    assert "room-1" not in tm._closed


# --------------------------------------------------------------------------
# 2. Only speaking -> * is a speech end
# --------------------------------------------------------------------------


def _state_event(old_state, new_state, created_at):
    return types.SimpleNamespace(
        old_state=old_state, new_state=new_state, created_at=created_at
    )


def _user_state_handler(room_id="room-1"):
    _, state_handlers, _ = handlers.create_conversation_handler(room_id, "2026-01-01")
    return state_handlers["user_state"]


def test_going_away_mid_turn_does_not_restart_the_latency_window():
    on_user_state = _user_state_handler()

    on_user_state(_state_event("speaking", "listening", 100.0))  # real speech end
    on_user_state(_state_event("listening", "away", 115.0))  # 15s away timeout

    # The agent finally speaks 20s after the learner actually stopped. Without
    # the guard this reported 5s — understating exactly the slow turns the
    # latency analytics exist to find.
    rec = tm.finalize("room-1", 120.0)
    assert rec is not None
    assert rec["response_latency_ms"] == 20000


def test_coming_back_from_away_does_not_start_a_turn():
    on_user_state = _user_state_handler()
    on_user_state(_state_event("away", "listening", 50.0))

    assert tm.finalize("room-1", 51.0) is None


def test_a_real_speech_end_still_opens_a_turn():
    on_user_state = _user_state_handler()
    on_user_state(_state_event("speaking", "listening", 100.0))

    rec = tm.finalize("room-1", 101.5)
    assert rec is not None
    assert rec["response_latency_ms"] == 1500
