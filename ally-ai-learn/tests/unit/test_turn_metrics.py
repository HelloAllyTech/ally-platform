"""Tests for the per-turn latency accumulator (app/core/metrics/turn_metrics.py)."""

import pytest

from app.core.metrics import turn_metrics as tm


@pytest.fixture(autouse=True)
def _reset_state():
    # Every module-level map, not just the turn ones: a transport noted for
    # "room-1" by another test on the same xdist worker otherwise leaks into
    # these records' metadata and fails an exact-equality assert at random.
    for store in (tm._turns, tm._turn_counters, tm._transports, tm._closed):
        store.clear()
    yield
    for store in (tm._turns, tm._turn_counters, tm._transports, tm._closed):
        store.clear()


def test_normal_turn_builds_record():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", orchestration_ms=50, llm_response_ms=300, llm_model="gpt-4o")
    rec = tm.finalize("room-1", 101.32)

    assert rec is not None
    assert rec["response_latency_ms"] == 1320
    assert rec["turn_index"] == 0
    assert rec["orchestration_ms"] == 50
    assert rec["llm_response_ms"] == 300
    assert rec["llm_model"] == "gpt-4o"


def test_prompt_cache_fields_are_carried_verbatim():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", prompt_tokens=3234, cached_tokens=2176)
    rec = tm.finalize("room-1", 101.0)

    assert rec is not None
    assert rec["prompt_tokens"] == 3234
    assert rec["cached_tokens"] == 2176


def test_turn_index_increments_per_room():
    tm.note_user_speech_end("room-1", 10.0)
    assert tm.finalize("room-1", 10.5)["turn_index"] == 0
    tm.note_user_speech_end("room-1", 20.0)
    assert tm.finalize("room-1", 20.5)["turn_index"] == 1
    # Independent counter per room.
    tm.note_user_speech_end("room-2", 5.0)
    assert tm.finalize("room-2", 5.4)["turn_index"] == 0


def test_record_before_user_speech_end_is_preserved():
    # Preemptive generation: a node records before endpointing fires.
    tm.record("room-1", llm_response_ms=200)
    tm.note_user_speech_end("room-1", 100.0)
    rec = tm.finalize("room-1", 100.5)

    assert rec["llm_response_ms"] == 200
    assert rec["response_latency_ms"] == 500
    assert rec["turn_index"] == 0


def test_finalize_without_user_speech_end_returns_none():
    # Agent opening line — no preceding user turn.
    assert tm.finalize("room-1", 100.0) is None
    # Even if a stray component was recorded but endpointing never fired.
    tm.record("room-1", llm_response_ms=100)
    assert tm.finalize("room-1", 100.0) is None


def test_negative_latency_is_clamped():
    tm.note_user_speech_end("room-1", 100.0)
    rec = tm.finalize("room-1", 99.9)  # agent_start before user_end (skew)
    assert rec["response_latency_ms"] == 0


def test_none_values_and_unknown_keys_ignored():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", llm_response_ms=None, bogus_field=123, branching_ms=40)
    rec = tm.finalize("room-1", 100.4)

    assert "llm_response_ms" not in rec  # None dropped
    assert "bogus_field" not in rec  # unknown dropped
    assert rec["branching_ms"] == 40


def test_finalize_pops_turn_so_next_starts_fresh():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", orchestration_ms=50)
    tm.finalize("room-1", 100.5)
    # New turn must not inherit the previous turn's components.
    tm.note_user_speech_end("room-1", 200.0)
    rec = tm.finalize("room-1", 200.3)
    assert "orchestration_ms" not in rec


def test_discard_clears_state():
    tm.note_user_speech_end("room-1", 100.0)
    tm.discard("room-1")
    assert tm.finalize("room-1", 100.5) is None


def test_discard_inflight_drops_turn_but_keeps_counter():
    # A turn that spans a pause must not emit an inflated latency on resume,
    # and the turn counter must keep advancing (turn_index stays unique).
    tm.note_user_speech_end("room-1", 100.0)  # turn 0
    tm.record("room-1", llm_response_ms=50)
    tm.discard_inflight("room-1")  # pause
    # Resume would finalize here; with the in-flight turn dropped, nothing emits.
    assert tm.finalize("room-1", 200.0) is None
    # Next real turn keeps a unique, advancing index and a clean latency.
    tm.note_user_speech_end("room-1", 300.0)
    rec = tm.finalize("room-1", 305.0)
    assert rec is not None
    assert rec["turn_index"] == 1  # not reset to 0
    assert rec["response_latency_ms"] == 5000  # no pause inflation
    assert "llm_response_ms" not in rec  # discarded turn's components gone


def test_metadata_merges_across_call_sites():
    # retrieval and generation both write metadata; neither may erase the other
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", metadata={"glossary_selected": ["emotions"]})
    tm.record("room-1", metadata={"llm_provider": "openai"})
    rec = tm.finalize("room-1", 101.0)

    assert rec is not None
    assert rec["metadata"] == {
        "glossary_selected": ["emotions"],
        "llm_provider": "openai",
        "firstAudioSource": "reply",
    }


def test_metadata_same_key_last_writer_wins():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", metadata={"a": 1})
    tm.record("room-1", metadata={"a": 2})
    rec = tm.finalize("room-1", 101.0)

    assert rec is not None
    assert rec["metadata"] == {"a": 2, "firstAudioSource": "reply"}


def test_filler_counts_as_first_audio():
    # The filler is the agent's first words: the metric measures to it, and the
    # unmasked time to the real reply is kept alongside.
    tm.note_user_speech_end("room-1", 100.0)
    tm.note_filler_started("room-1", 100.4)
    rec = tm.finalize("room-1", 102.5)

    assert rec is not None
    assert rec["response_latency_ms"] == 400
    assert rec["metadata"]["firstAudioSource"] == "filler"
    assert rec["metadata"]["replyLatencyMs"] == 2500


def test_interim_reply_counts_as_first_audio():
    tm.note_user_speech_end("room-1", 100.0)
    tm.note_filler_started("room-1", 100.9, kind="interim")
    rec = tm.finalize("room-1", 103.0)

    assert rec is not None
    assert rec["response_latency_ms"] == 900
    assert rec["metadata"]["firstAudioSource"] == "interim"
    assert rec["metadata"]["replyLatencyMs"] == 3000


def test_earliest_masking_audio_wins_and_keeps_its_kind():
    # Filler plays first, interim follows before the real reply: the filler is
    # what the learner heard first, so it owns both the time and the label.
    tm.note_user_speech_end("room-1", 100.0)
    tm.note_filler_started("room-1", 100.3)
    tm.note_filler_started("room-1", 100.8, kind="interim")
    rec = tm.finalize("room-1", 102.0)

    assert rec is not None
    assert rec["response_latency_ms"] == 300
    assert rec["metadata"]["firstAudioSource"] == "filler"


def test_unmasked_turn_is_labelled_reply_with_no_reply_latency():
    tm.note_user_speech_end("room-1", 100.0)
    rec = tm.finalize("room-1", 101.2)

    assert rec is not None
    assert rec["response_latency_ms"] == 1200
    assert rec["metadata"]["firstAudioSource"] == "reply"
    assert "replyLatencyMs" not in rec["metadata"]


def test_backchannel_during_user_speech_is_not_first_audio():
    # Audio before the user finished (a back-channel "mm-hmm") is not a
    # response to the turn; crediting it would report a negative-ish latency.
    tm.note_user_speech_end("room-1", 100.0)
    tm._turns["room-1"]["filler_start_ts"] = 99.5
    tm._turns["room-1"]["first_audio_kind"] = "filler"
    rec = tm.finalize("room-1", 101.0)

    assert rec is not None
    assert rec["response_latency_ms"] == 1000
    assert rec["metadata"]["firstAudioSource"] == "reply"


def test_filler_provenance_merges_with_node_metadata():
    tm.note_user_speech_end("room-1", 100.0)
    tm.record("room-1", metadata={"knowledgeRetrievalReused": True})
    tm.note_filler_started("room-1", 100.5)
    rec = tm.finalize("room-1", 102.0)

    assert rec is not None
    assert rec["metadata"] == {
        "knowledgeRetrievalReused": True,
        "firstAudioSource": "filler",
        "replyLatencyMs": 2000,
    }
