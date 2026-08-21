"""Per-turn latency metric accumulation for the voice agent.

A turn's *total* latency (user stops speaking → agent starts speaking) is
observed in the session event handlers, while its *component* timings
(orchestration, LLM, …) are recorded inside the graph nodes, and
*framework* timings (EOU delay, LLM TTFT, TTS TTFB) arrive via LiveKit's
MetricsCollectedEvent — three different call sites on the same event loop.

This module is the small in-memory buffer that stitches them into one record
per turn, keyed by ``room_id`` (a voice conversation processes one turn at a
time per room). It is deliberately pure and side-effect free — no network, no
config — so it is trivially unit-testable; the handler layer reads the finalized
record and ships it to Core over SQS.

``response_latency_ms`` is time-to-FIRST-AUDIO: a thinking-filler or predictive
interim reply is the agent's real first words, so whichever the learner heard
first is what the metric measures. ``metadata.firstAudioSource`` records which
('filler' | 'interim' | 'reply') and, when it was masking speech,
``metadata.replyLatencyMs`` keeps the unmasked time to the real reply.

Lifecycle for a normal turn:
    note_user_speech_end(room)   # user stopped → a turn begins (sets ts + index)
    record(room, orchestration_ms=…, llm_response_ms=…, …)   # graph nodes
    record(room, llm_ttft_ms=…, tts_ttfb_ms=…)               # LiveKit metrics
    finalize(room, agent_speech_start_ts) -> dict | None      # agent speaks

``record`` lazily creates the in-flight turn if called first (e.g. preemptive
generation fires a node before endpointing), so component timings are never
lost. ``finalize`` only returns a record when a user_speech_end was seen (so we
have a real latency to report); otherwise it returns None and the caller skips.
"""

from __future__ import annotations

from typing import Any, Dict, Optional

# room_id -> in-flight turn fields (snake_case keys matching TurnMetricsData).
_turns: Dict[str, Dict[str, Any]] = {}
# room_id -> monotonically increasing turn counter.
_turn_counters: Dict[str, int] = {}
# room_id -> True once finalize() has closed a turn and no new one has begun.
# See _POST_FINALIZE_FIELDS.
_closed: Dict[str, bool] = {}

# Fields carried verbatim into the finalized record.
_RECORD_FIELDS = {
    "invocation_id",
    "eou_delay_ms",
    "stt_finalize_ms",
    "llm_ttft_ms",
    "tts_ttfb_ms",
    "orchestration_ms",
    "llm_response_ms",
    "branching_ms",
    "knowledge_retrieval_ms",
    "process_events_ms",
    "behaviors_ms",
    "scenario_id",
    "language",
    "llm_model",
    "llm_provider",
    "temperature",
    "top_p",
    "max_tokens",
    "response_chars",
    "events_detected",
    "llm_timed_out",
    "interrupted",
    "metadata",
    "prompt_tokens",
    "cached_tokens",
}

# Framework timings that LiveKit emits only once the LLM / TTS stream has
# COMPLETED — i.e. strictly after the agent began speaking, which is the moment
# finalize() closes the turn. They must never lazily create a turn: the dict
# they created was adopted by the NEXT note_user_speech_end (setdefault returns
# it), so turn N's time-to-first-token was reported as turn N+1's. Every other
# field still creates lazily, because a graph node genuinely can run before
# endpointing (preemptive generation) and those timings belong to the turn that
# is about to begin.
_POST_FINALIZE_FIELDS = {"llm_ttft_ms", "tts_ttfb_ms"}


def note_user_speech_end(room_id: str, user_speech_end_ts: float) -> None:
    """Mark the start of a new turn's latency window for ``room_id``."""
    _closed.pop(room_id, None)
    turn = _turns.setdefault(room_id, {})
    turn["user_speech_end_ts"] = user_speech_end_ts
    if "turn_index" not in turn:
        turn["turn_index"] = _turn_counters.get(room_id, 0)
    _turn_counters[room_id] = turn["turn_index"] + 1


def note_filler_started(
    room_id: str, filler_start_ts: float, kind: str = "filler"
) -> None:
    """Record when masking speech first became audible this turn.

    ``response_latency_ms`` is measured to the FIRST audio the learner hears, so
    when the agent speaks a thinking-filler or a predictive interim reply (both
    on the agent's "thinking" state, before the real reply) that start time —
    not the reply's — is the response time. Only the EARLIEST such audio in a
    turn is kept, along with ``kind`` ('filler' | 'interim') so finalize can
    report which one the learner actually heard first. No-op if there's no
    in-flight turn yet.
    """
    if not room_id:
        return
    turn = _turns.setdefault(room_id, {})
    if "filler_start_ts" in turn:
        return
    turn["filler_start_ts"] = filler_start_ts
    turn["first_audio_kind"] = kind


def record(room_id: str, **fields: Any) -> None:
    """Merge component/framework timings into the in-flight turn.

    Unknown keys and ``None`` values are ignored. Lazily creates the turn so a
    node that runs before endpointing (preemptive generation) isn't dropped —
    except for ``_POST_FINALIZE_FIELDS`` arriving after a finalize, which belong
    to the turn that just closed and are dropped rather than misattributed to
    the next one.
    """
    if not room_id:
        return
    turn = _turns.get(room_id)
    for key, value in fields.items():
        if value is None or key not in _RECORD_FIELDS:
            continue
        if key in _POST_FINALIZE_FIELDS and _closed.get(room_id):
            # Its turn is already reported; attributing it here would shift it
            # one turn forward.
            continue
        if turn is None:
            turn = _turns.setdefault(room_id, {})
        # ``metadata`` is a grab-bag dict written by independent call sites
        # (retrieval, generation, …) — merge instead of last-writer-wins so
        # one site's keys can't silently erase another's.
        if key == "metadata" and isinstance(value, dict):
            existing = turn.get("metadata")
            turn["metadata"] = (
                {**existing, **value} if isinstance(existing, dict) else dict(value)
            )
            continue
        turn[key] = value


def finalize(room_id: str, agent_speech_start_ts: float) -> Optional[Dict[str, Any]]:
    """Close the in-flight turn and return its metrics record, or None.

    Returns None when there is no in-flight turn with a recorded
    ``user_speech_end_ts`` (e.g. the agent's opening line, which has no
    preceding user turn) — nothing meaningful to report.
    """
    turn = _turns.pop(room_id, None)
    _closed[room_id] = True
    if not turn or "user_speech_end_ts" not in turn:
        return None

    user_end = turn["user_speech_end_ts"]
    # response_latency_ms = time to the FIRST audio the learner hears. When a
    # thinking-filler played, it became audible (on "thinking") before the real
    # reply, so its start is the response time; otherwise use the reply's. Guard
    # the filler ts to the turn window so a stale/out-of-order value can't skew.
    first_audio_ts = agent_speech_start_ts
    masked = False
    filler_start_ts = turn.get("filler_start_ts")
    if filler_start_ts is not None and user_end <= filler_start_ts < first_audio_ts:
        first_audio_ts = filler_start_ts
        masked = True

    latency_ms = (first_audio_ts - user_end) * 1000.0
    # Clock skew / out-of-order events can yield a small negative; clamp to 0.
    latency_ms = max(0, round(latency_ms))

    record_out: Dict[str, Any] = {
        "turn_index": turn.get("turn_index", 0),
        "response_latency_ms": latency_ms,
    }
    for key in _RECORD_FIELDS:
        if key in turn:
            record_out[key] = turn[key]

    # Provenance for the headline metric. Crediting a filler/interim is what
    # the learner actually experienced, but on its own it makes a turn where
    # the real reply took 4s indistinguishable from a genuinely fast one — so
    # a dashboard could read "latency improved" when only filler coverage went
    # up. Record WHICH audio was counted, and keep the unmasked
    # user_speech_end -> real-reply time alongside it, so the two are always
    # separable at query time.
    first_audio_source = turn.get("first_audio_kind", "filler") if masked else "reply"
    provenance: Dict[str, Any] = {"firstAudioSource": first_audio_source}
    if masked:
        provenance["replyLatencyMs"] = max(
            0, round((agent_speech_start_ts - user_end) * 1000.0)
        )
    existing_meta = record_out.get("metadata")
    record_out["metadata"] = (
        {**existing_meta, **provenance}
        if isinstance(existing_meta, dict)
        else provenance
    )
    return record_out


def discard(room_id: str) -> None:
    """Drop any in-flight turn for a room (e.g. on session shutdown)."""
    _turns.pop(room_id, None)
    _turn_counters.pop(room_id, None)
    _closed.pop(room_id, None)


def discard_inflight(room_id: str) -> None:
    """Drop the in-flight turn's accumulated timings but KEEP the turn counter.

    Used on pause: a turn that spans a pause has no clean latency to report
    (the gap would include the paused wall-clock), so we discard it rather than
    emit a wildly inflated ``response_latency_ms`` outlier into the latency
    analytics. The counter is preserved so later turn_index values stay unique.
    """
    _turns.pop(room_id, None)
