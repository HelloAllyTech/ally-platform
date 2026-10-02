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
# room_id -> which audio output is carrying the agent's speech right now.
# SESSION state, not turn state: it changes at most once, when a video actor
# attaches mid-session, so it must outlive _turns (cleared every turn).
_transports: Dict[str, Dict[str, Any]] = {}
#: Session-scoped voice model per room, reported as ``metadata.ttsModel``.
_tts_models: Dict[str, str] = {}

#: The audio outputs the agent's speech can ride, recorded per turn as
#: ``metadata.speechTransport``.
#:
#: This exists because ``response_latency_ms`` does NOT mean the same thing on
#: both. The metric is derived from the ``agent_state == "speaking"``
#: transition, which livekit drives off ``AudioOutput.on_playback_started``:
#:
#:  - ``room``   — the agent publishes its own track, and the room output fires
#:                 that callback when the first frame is actually captured into
#:                 the published audio source. Accurate.
#:  - ``avatar`` — the speech is routed to a vendor's renderer, and
#:                 ``DataStreamAudioOutput`` fires the callback when the first
#:                 frame is written into the byte stream TO THE VENDOR, carrying
#:                 livekit's own comment "Not ideal since frame isn't actually
#:                 playing yet / potentially we need another RPC for this". The
#:                 vendor's transport, render and republish time is therefore
#:                 EXCLUDED, so the number is optimistic by an unmeasured
#:                 amount. bey took 12.7-16.7s just to publish its first video
#:                 locally, so the per-utterance lag is not a rounding error.
#:
#: There is no "playback started" signal from any vendor (only
#: ``RPC_PLAYBACK_FINISHED``), so an avatar turn's latency cannot be made
#: correct here. Recording which transport carried the turn is the honest
#: alternative: dashboards can segment or exclude those turns instead of
#: silently mixing two different measurements into one trend — the same reason
#: the ``source`` column separates 'pipeline' from 'transcript' rows.
#:
#: Written on EVERY turn, including plain audio ones. A value that appeared
#: only for avatar turns would make NULL mean "room output" and "emitted by a
#: build from before this shipped" at the same time, which is exactly the
#: ambiguity it exists to remove.
SPEECH_TRANSPORTS = frozenset({"room", "avatar"})

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


def note_speech_transport(
    room_id: str, transport: str, provider: Optional[str] = None
) -> None:
    """Record which audio output carries the agent's speech from now on.

    Called when the transport is established and again if it changes — which
    happens exactly once, when a video actor attaches mid-session. Every turn
    finalized afterwards reports the new value, and turns before it keep the
    old one, so a single session's rows can legitimately carry both.

    ``provider`` is the vendor rendering the speech ('bey', 'tavus'), recorded
    only for ``avatar``: two vendors have very different lag, so an aggregate
    over 'avatar' that cannot tell them apart is not worth much.

    Ignores an unknown transport rather than storing it, for the same reason
    ``note_filler_decision`` does: a typo must not create a phantom bucket that
    a dashboard then reports on.
    """
    if not room_id or transport not in SPEECH_TRANSPORTS:
        return
    entry: Dict[str, Any] = {"speechTransport": transport}
    if provider:
        entry["speechTransportProvider"] = provider
    _transports[room_id] = entry


def note_tts_model(room_id: str, provider: Optional[str], model: Optional[str]) -> None:
    """Record which voice model speaks this session, as ``provider/model``.

    Masking depends on it: a voice that cannot render clips (the generative
    voices the clip policy refuses) gets no spoken opener, bridge or interim,
    so its turns are reply-first by construction. Without this a shift in voice mix
    reads on the dashboard as a latency regression.
    """
    if not room_id or not model:
        return
    _tts_models[room_id] = f"{provider}/{model}" if provider else str(model)


#: What an interim-first turn's interim was, as ``metadata.interimSource``:
#: the delivery plan's bridge line, or the legacy interim reply. Both are
#: ``firstAudioSource='interim'``; without this the dashboard can't tell which
#: system is masking the turn.
INTERIM_SOURCES = frozenset({"bridge", "legacy"})


def note_filler_started(
    room_id: str,
    filler_start_ts: float,
    kind: str = "filler",
    interim_source: Optional[str] = None,
) -> None:
    """Record when masking speech first became audible this turn.

    ``response_latency_ms`` is measured to the FIRST audio the learner hears, so
    when the agent speaks a thinking-filler or a predictive interim reply (both
    on the agent's "thinking" state, before the real reply) that start time —
    not the reply's — is the response time. ("The first audio the learner hears"
    holds exactly on the ``room`` transport; see SPEECH_TRANSPORTS for why an
    ``avatar`` turn's reply timestamp is early, and note that masking audio
    plays on the agent's own track either way, so a MASKED avatar turn's
    headline number is still sound while its ``replyLatencyMs`` is not.)

    Only the EARLIEST such audio in a turn is kept, along with ``kind``
    ('filler' | 'interim') so finalize can report which one the learner
    actually heard first. No-op if there's no
    in-flight turn yet.
    """
    if not room_id:
        return
    turn = _turns.setdefault(room_id, {})
    if "filler_start_ts" in turn:
        return
    turn["filler_start_ts"] = filler_start_ts
    turn["first_audio_kind"] = kind
    # Only the call that WON first audio labels it, so a later sound can't.
    if kind == "interim" and interim_source in INTERIM_SOURCES:
        turn["interim_source"] = interim_source


#: Decisions the filler layer can reach on a turn, recorded as
#: ``metadata.fillerDecision``. Without this a turn with no filler is
#: indistinguishable from a turn where the feature is off, so coverage — the
#: share of SLOW turns that actually got masked — cannot be measured at all,
#: only the share of all turns, which moves when turn speed moves.
FILLER_DECISIONS = frozenset(
    {
        "played",
        "skipped_fast_turn",  # predicted gap too small to be worth masking
        "skipped_probability",  # real gap, but the cadence/probability gate declined
        "skipped_no_clips",  # nothing synthesized yet for this session
        "skipped_reply_ready",  # reply arrived before the filler could start
        # The character has a face and this layer's track is not lip-synced, so
        # a filler here would be a voice from a motionless mouth. Its own
        # bucket because it is the one decision that says nothing about the
        # turn's gap: folding it into skipped_probability would make the
        # cadence gate look like it declined turns it never saw.
        "skipped_video_actor",
        "disabled",  # feature off globally or for this scenario
        # ---- delivery-plan openers (app/core/livekit/opener_policy.py) ----
        # Chose no opener on purpose: variety across turns, or a pause fits.
        # Its own bucket because "no sound" is one of the natural first sounds,
        # not a failure to fill.
        "skipped_policy",
        # The learner's last words read as unfinished; an opener would land on
        # the rest of their sentence.
        "skipped_learner_unfinished",
        "skipped_closing",  # the learner was saying goodbye
        # Decided, then withdrawn during the hold: the learner spoke, the reply
        # arrived, or a face attached. Nothing was heard.
        "cancelled_before_play",
        # An opener already played earlier in this reply cycle (the learner
        # paused, heard it, and went on); a second would stack two fillers.
        "skipped_same_reply",
    }
)


def note_filler_decision(room_id: str, decision: str, **details: Any) -> None:
    """Record what the filler layer decided this turn, and why.

    Written into the turn's ``metadata`` (merged, so it can't clobber another
    call site's keys) alongside whichever details apply:
    ``fillerLeadMs`` (thinking -> the first audio frame ACTUALLY captured, not an
    estimate), ``fillerDurationMs``, ``fillerClipSource``, ``fillerPhraseAgeTurns``,
    ``postFillerSilenceMs`` and ``fillerCutEarlyMs``.

    Only the FIRST decision of a turn is kept: a continuation filler must not
    overwrite the record of the one that opened the turn. No-op for an unknown
    decision so a typo can't silently create a phantom bucket in the dashboard.
    """
    if not room_id or decision not in FILLER_DECISIONS:
        return
    turn = _turns.setdefault(room_id, {})
    existing = turn.get("metadata")
    meta = dict(existing) if isinstance(existing, dict) else {}
    # First decision wins, except that "played" replaces an earlier skip: a
    # false endpoint gives one turn two "thinking" states, and the second one
    # playing an opener is what the learner actually heard.
    if "fillerDecision" not in meta or (
        decision == "played" and meta.get("fillerDecision") != "played"
    ):
        meta["fillerDecision"] = decision
    for key, value in details.items():
        if value is not None:
            meta[key] = value
    turn["metadata"] = meta


def note_filler_ended(room_id: str, filler_end_ts: float) -> None:
    """Record when the LAST masking audio of the turn finished playing.

    finalize turns it into ``postFillerSilenceMs`` — the silence between the
    opener (or bridge line) ending and the reply starting — which is the number
    the rubric's "a slight thinking gap, not dead air" is judged on. Before this
    it was documented but never written, so dead air could only be inferred.
    """
    if not room_id:
        return
    turn = _turns.setdefault(room_id, {})
    turn["filler_end_ts"] = filler_end_ts


def note_filler_continuation(room_id: str) -> None:
    """Count an extra filler played later in the same turn (the continuation).

    Kept separate from the opening decision so ``fillerDecision`` stays a clean
    one-per-turn bucket while still showing when a turn needed more than one
    filler to reach the reply.
    """
    if not room_id:
        return
    turn = _turns.setdefault(room_id, {})
    existing = turn.get("metadata")
    meta = dict(existing) if isinstance(existing, dict) else {}
    meta["fillerCount"] = int(meta.get("fillerCount") or 1) + 1
    turn["metadata"] = meta


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
    if first_audio_source == "interim" and turn.get("interim_source"):
        provenance["interimSource"] = turn["interim_source"]
    # Which output carried the speech, so a turn whose latency EXCLUDES a
    # vendor's render time is identifiable rather than silently averaged in
    # with turns that measured the real thing. See SPEECH_TRANSPORTS.
    provenance.update(_transports.get(room_id, {}))
    if room_id in _tts_models:
        provenance["ttsModel"] = _tts_models[room_id]
    if masked:
        provenance["replyLatencyMs"] = max(
            0, round((agent_speech_start_ts - user_end) * 1000.0)
        )
        filler_end_ts = turn.get("filler_end_ts")
        if filler_end_ts is not None and filler_start_ts <= filler_end_ts:
            # Negative = the reply started before the opener finished (it was
            # cut); clamped, and flagged separately.
            gap_ms = round((agent_speech_start_ts - filler_end_ts) * 1000.0)
            provenance["postFillerSilenceMs"] = max(0, gap_ms)
            if gap_ms < 0:
                provenance["fillerCutEarlyMs"] = -gap_ms
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
    # Session-scoped, so it goes only when the session does — NOT in
    # discard_inflight, which drops a paused turn while the session continues
    # on the same transport.
    _transports.pop(room_id, None)
    _tts_models.pop(room_id, None)


def discard_inflight(room_id: str) -> None:
    """Drop the in-flight turn's accumulated timings but KEEP the turn counter.

    Used on pause: a turn that spans a pause has no clean latency to report
    (the gap would include the paused wall-clock), so we discard it rather than
    emit a wildly inflated ``response_latency_ms`` outlier into the latency
    analytics. The counter is preserved so later turn_index values stay unique.
    """
    _turns.pop(room_id, None)
