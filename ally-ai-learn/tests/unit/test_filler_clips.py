"""Tests for in-memory clip rendering, the shared cache, and the phrase pool.

These cover the three things the filler layer newly relies on and that are easy
to get subtly wrong: audio arrives at the mixer's rate (or it plays at the wrong
pitch), the cache is keyed tightly enough that a clip can never be served in the
wrong voice, and the pool's selection rules actually hold.
"""

import pytest

from app.core.livekit import filler_clips
from app.core.livekit.filler_clips import (
    MIXER_SAMPLE_RATE,
    FillerClip,
    synthesize_clips,
    tier_for_duration,
    voice_fingerprint,
)
from app.core.livekit.filler_pool import FillerPool
from app.core.livekit.gap_predictor import GapPredictor


class _FakeFrame:
    def __init__(self, data, sample_rate=24000, num_channels=1):
        self.data = data
        self.sample_rate = sample_rate
        self.num_channels = num_channels


class _FakeEvent:
    def __init__(self, frame):
        self.frame = frame


class _FakeStream:
    def __init__(self, frames, raise_exc=False):
        self._frames = frames
        self._raise = raise_exc
        self._i = 0

    def __aiter__(self):
        return self

    async def __anext__(self):
        if self._raise:
            raise RuntimeError("synth boom")
        if self._i >= len(self._frames):
            raise StopAsyncIteration
        frame = self._frames[self._i]
        self._i += 1
        return _FakeEvent(frame)

    async def aclose(self):
        pass


class _FakeTTS:
    """One-shot synthesis of a fixed tone, at a provider-ish sample rate."""

    def __init__(self, sample_rate=24000, samples=7200, fail_phrases=()):
        self.sample_rate = sample_rate
        self.samples = samples
        self.fail_phrases = set(fail_phrases)
        self.calls = []

    def synthesize(self, text):
        self.calls.append(text)
        if text in self.fail_phrases:
            return _FakeStream([], raise_exc=True)
        # Audible (renders now trim edge silence), int16 LE 8000.
        pcm = b"\x40\x1f" * self.samples
        return _FakeStream([_FakeFrame(pcm, self.sample_rate, 1)])

    def stream(self):
        return _FakeStream([])

    async def aclose(self):
        pass


class _FakeClient:
    def __init__(self, tts=None, voice="v1", speed=1.0):
        self._tts = tts or _FakeTTS()
        self._voice = voice
        self._speed = speed
        self._current_params = {"voice": voice}
        self._default_params = {"speed": speed}

    def create_clip_tts(self):
        return self._tts


@pytest.fixture(autouse=True)
def _fresh_cache(monkeypatch):
    """Each test gets its own cache — the real one is worker-wide by design."""
    monkeypatch.setattr(filler_clips, "_CACHE", filler_clips._ClipCache(max_entries=50))


class TestRendering:
    async def test_clip_is_resampled_to_the_mixer_rate(self):
        """A provider's 24kHz output must reach the 48kHz mixer as 48kHz.

        Handing the mixer off-rate frames makes the filler play at the wrong
        pitch and speed, which is worse than not playing it.
        """
        client = _FakeClient(_FakeTTS(sample_rate=24000, samples=7200))

        clips = await synthesize_clips(client, ["hmm"])

        assert len(clips) == 1
        assert all(f.sample_rate == MIXER_SAMPLE_RATE for f in clips[0].frames)
        # 7200 samples at 24kHz = 300ms, and resampling preserves duration.
        assert clips[0].duration_ms == pytest.approx(300.0, abs=2.0)

    async def test_duration_drives_the_tier(self):
        client = _FakeClient(_FakeTTS(sample_rate=24000, samples=24000))  # 1s

        clips = await synthesize_clips(client, ["let me think"])

        assert clips[0].duration_ms == pytest.approx(1000.0, abs=5.0)
        assert clips[0].tier == "short"

    async def test_typed_input_keeps_its_tag(self):
        client = _FakeClient()
        clips = await synthesize_clips(client, [("mm", "acknowledgement")])
        assert clips[0].filler_type == "acknowledgement"

    async def test_one_failure_does_not_lose_the_batch(self):
        client = _FakeClient(_FakeTTS(fail_phrases={"bad"}))
        clips = await synthesize_clips(client, ["good", "bad", "also good"])
        assert [c.phrase for c in clips] == ["good", "also good"]

    async def test_no_isolated_tts_means_no_synthesis(self):
        """Rather than fall back to the session's own TTS instance.

        Clip errors on the shared instance burn the AgentSession's error budget
        and have killed live sessions (prod Marathi outage, 2026-08-20).
        """

        class _NoIsolation:
            _current_params = {}

            def create_clip_tts(self):
                return None

        assert await synthesize_clips(_NoIsolation(), ["hmm"]) == []


class TestCache:
    async def test_second_render_of_a_phrase_is_served_from_cache(self):
        tts = _FakeTTS()
        client = _FakeClient(tts)

        await synthesize_clips(client, ["hmm"], language="en-US")
        await synthesize_clips(client, ["hmm"], language="en-US")

        assert tts.calls == ["hmm"]  # synthesized once, reused after

    async def test_a_different_voice_never_reuses_a_clip(self):
        """The whole risk of caching: a filler in the wrong voice.

        A cache key that missed a voice parameter would hand one character's
        hesitation to another, which is far worse than an extra TTS call.
        """
        tts_a = _FakeTTS()
        tts_b = _FakeTTS()
        client_a = _FakeClient(tts_a, voice="asha")
        client_b = _FakeClient(tts_b, voice="ravi")

        await synthesize_clips(client_a, ["hmm"], language="en-US")
        await synthesize_clips(client_b, ["hmm"], language="en-US")

        assert tts_a.calls == ["hmm"]
        assert tts_b.calls == ["hmm"]

    async def test_a_different_language_never_reuses_a_clip(self):
        tts = _FakeTTS()
        client = _FakeClient(tts)
        await synthesize_clips(client, ["hmm"], language="en-US")
        await synthesize_clips(client, ["hmm"], language="ta-IN")
        assert len(tts.calls) == 2

    def test_fingerprint_changes_with_any_voice_parameter(self):
        base = _FakeClient(voice="asha", speed=1.0)
        faster = _FakeClient(voice="asha", speed=1.4)
        assert voice_fingerprint(base) != voice_fingerprint(faster)

    async def test_variants_are_distinct_renderings(self):
        """A repeat must not be the identical waveform."""
        tts = _FakeTTS()
        client = _FakeClient(tts)

        await synthesize_clips(client, [("hmm", "hesitation", 0)])
        await synthesize_clips(client, [("hmm", "hesitation", 1)])

        assert len(tts.calls) == 2
        assert tts.calls[0] != tts.calls[1]


def _clip(phrase, duration_ms=1000.0, ftype="hesitation", variant=0):
    return FillerClip(
        phrase=phrase,
        frames=[],
        duration_ms=duration_ms,
        filler_type=ftype,
        variant=variant,
    )


class TestPool:
    def test_accumulates_rather_than_replacing(self):
        pool = FillerPool()
        pool.add([_clip("a"), _clip("b")])
        pool.add([_clip("c")])
        assert len(pool) == 3

    def test_duplicate_phrases_are_ignored_but_variants_are_not(self):
        pool = FillerPool()
        pool.add([_clip("a")])
        pool.add([_clip("a")])
        assert len(pool) == 1
        pool.add([_clip("a", variant=1)])
        assert len(pool) == 2

    def test_unplayed_clips_count_as_fresh(self):
        """A never-played clip is the freshest thing in the pool.

        Comparing its -1 sentinel against the recency cutoff would call a whole
        unused batch stale and trigger needless regeneration.
        """
        pool = FillerPool(repeat_window_plays=6)
        pool.add([_clip(f"p{i}") for i in range(5)])
        assert pool.fresh_count() == 5

    def _play(self, pool, target_ms=None):
        """choose() + mark_played(), which is how the worker always uses it."""
        clip = pool.choose(target_ms=target_ms)
        if clip is not None:
            pool.mark_played(clip)
        return clip

    def test_does_not_repeat_within_the_window(self):
        pool = FillerPool(repeat_window_plays=6)
        pool.add([_clip("a"), _clip("b")])
        first = self._play(pool)
        second = self._play(pool)
        assert first.phrase != second.phrase

    def test_rotates_the_filler_type(self):
        pool = FillerPool()
        pool.add(
            [
                _clip("a", ftype="hesitation"),
                _clip("b", ftype="hesitation"),
                _clip("c", ftype="acknowledgement"),
            ]
        )
        first = self._play(pool)
        second = self._play(pool)
        assert first.filler_type != second.filler_type

    def test_picks_a_clip_that_fits_the_gap(self):
        """The point of tiers: a short hum must not be chosen for a long wait."""
        pool = FillerPool()
        pool.add(
            [
                _clip("short one", duration_ms=400.0),
                _clip("a longer reflective one", duration_ms=1800.0),
            ]
        )
        assert pool.choose(target_ms=1800.0).phrase == "a longer reflective one"
        assert pool.choose(target_ms=300.0).phrase == "short one"

    def test_a_single_clip_still_plays(self):
        """Rules degrade rather than starve playback."""
        pool = FillerPool()
        pool.add([_clip("only")])
        assert self._play(pool).phrase == "only"
        assert self._play(pool).phrase == "only"

    def test_variant_needed_lists_played_phrases_with_one_take(self):
        pool = FillerPool()
        pool.add([_clip("a"), _clip("b")])
        chosen = self._play(pool)
        assert [p for p, _, _ in pool.variant_needed()] == [chosen.phrase]

    def test_eviction_keeps_the_pool_bounded(self):
        pool = FillerPool(max_clips=3)
        pool.add([_clip(f"p{i}") for i in range(10)])
        assert len(pool) == 3


class TestGapPredictor:
    def test_uses_the_prior_until_warm(self):
        predictor = GapPredictor(prior_ms=900.0, min_samples=2)
        assert predictor.predict_ms() == 900.0
        predictor.observe_turn(llm_ttft_ms=200.0, tts_ttfb_ms=100.0)
        assert predictor.predict_ms() == 900.0  # one sample is not enough

    def test_tracks_observed_latency(self):
        predictor = GapPredictor(prior_ms=900.0, alpha=0.5, min_samples=1)
        predictor.observe_turn(llm_ttft_ms=1000.0, tts_ttfb_ms=1000.0)
        predictor.observe_turn(llm_ttft_ms=1000.0, tts_ttfb_ms=1000.0)
        assert predictor.predict_ms() == pytest.approx(2000.0)

    def test_one_pathological_turn_cannot_poison_the_estimate(self):
        """A 30s LLM timeout must not make every later turn look slow."""
        predictor = GapPredictor(prior_ms=900.0, alpha=0.4, min_samples=1)
        predictor.observe(500.0)
        predictor.observe(300_000.0)  # clamped
        assert predictor.predict_ms() <= 10_000.0

    def test_ignores_missing_and_nonsense_values(self):
        predictor = GapPredictor(prior_ms=900.0, min_samples=1)
        predictor.observe(None)
        predictor.observe(-5)
        predictor.observe("nope")
        assert predictor.samples == 0
        assert predictor.predict_ms() == 900.0


class TestTiers:
    @pytest.mark.parametrize(
        "duration_ms,expected",
        [(0.0, "micro"), (400.0, "micro"), (900.0, "short"), (2500.0, "long")],
    )
    def test_tier_boundaries(self, duration_ms, expected):
        assert tier_for_duration(duration_ms) == expected


class TestTranscriptMarker:
    """A filler, an interim and a real reply all arrive as CLIENT lines.

    One turn can emit all three in a row, so a consumer that tries to tell them
    apart by position guesses wrong the moment a continuation filler plays.
    `utterance_kind` is what makes them distinguishable downstream.
    """

    def test_chat_message_defaults_to_unknown(self):
        """None is deliberately distinct from 'reply' — an older worker sent
        neither, and reading that silence as a real reply would mislabel every
        filler in the backlog."""
        from app.core.events.base import ChatMessage

        message = ChatMessage(role="CLIENT", content="Hmm")
        assert message.utterance_kind is None

    def test_the_three_kinds_round_trip(self):
        from app.core.events.base import ChatMessage

        for kind in ("reply", "filler", "interim"):
            message = ChatMessage(role="CLIENT", content="x", utterance_kind=kind)
            assert message.model_dump()["utterance_kind"] == kind

    async def test_worker_marks_a_filler_line(self, monkeypatch):
        """End to end through the real emitter, not just the model.

        Async because the emitter schedules the send with create_task; run
        synchronously it raises, the emitter swallows it (a filler must never
        break a turn), and the test would pass on a payload that never left.
        """
        import asyncio as _asyncio
        import types as _types

        from app import worker as worker_module

        sent = []

        async def _capture(payload):
            sent.append(payload)

        monkeypatch.setattr("app.core.events.handlers.send_event_to_queue", _capture)
        ctx = _types.SimpleNamespace(
            room=_types.SimpleNamespace(name="room-1"),
            proc=_types.SimpleNamespace(userdata={}),
        )
        w = worker_module.AgentWorker(ctx)
        w.joined_iso = None
        w._emit_filler_transcript("Hmm", None)
        await _asyncio.sleep(0)  # let the scheduled send run

        assert sent, "the filler transcript was never sent"
        assert '"utterance_kind":"filler"' in sent[0].replace(" ", "")


class TestClipTtsUsage:
    """Real clip synthesis is recorded as clip_tts; cache hits are free."""

    async def test_synthesis_records_characters_against_the_room(self, ai_usage_calls):
        client = _FakeClient()

        await synthesize_clips(
            client,
            ["hmm", "I see"],
            language="en-US",
            usage_room_id="room-9",
            usage_provider="cartesia",
            usage_model="sonic-2",
        )

        assert ai_usage_calls == [
            {
                "room_id": "room-9",
                "service": "tts",
                "provider": "cartesia",
                "model": "sonic-2",
                "task": "clip_tts",
                "characters": len("hmm") + len("I see"),
            }
        ]

    async def test_cache_hit_records_nothing(self, ai_usage_calls):
        client = _FakeClient()
        await synthesize_clips(client, ["hmm"], language="en-US", usage_room_id="r")
        ai_usage_calls.clear()

        await synthesize_clips(client, ["hmm"], language="en-US", usage_room_id="r")

        assert ai_usage_calls == []

    async def test_bills_the_variant_text_actually_sent(self, ai_usage_calls):
        client = _FakeClient()

        await synthesize_clips(client, [("MMM", "hesitation", 1)], usage_room_id="r")

        sent = client._tts.calls[0]
        assert ai_usage_calls[0]["characters"] == len(sent)

    async def test_failed_phrase_is_not_billed(self, ai_usage_calls):
        client = _FakeClient(_FakeTTS(fail_phrases={"bad"}))

        await synthesize_clips(client, ["good", "bad"], usage_room_id="r")

        assert ai_usage_calls[0]["characters"] == len("good")

    async def test_no_isolated_instance_records_nothing(self, ai_usage_calls):
        class _NoIsolation(_FakeClient):
            def create_clip_tts(self):
                return None

        await synthesize_clips(_NoIsolation(), ["hmm"], usage_room_id="r")

        assert ai_usage_calls == []


class TestRenderHygiene:
    """Edge silence is latency and an implausible length is a bad generation;
    both are handled once, at render time."""

    @staticmethod
    def _pcm(*segments):
        import array

        out = array.array("h")
        for ms, amp in segments:
            out.extend([amp] * int(filler_clips.MIXER_SAMPLE_RATE * ms / 1000))
        return out.tobytes()

    def _ms(self, pcm):
        return len(pcm) / 2 / filler_clips.MIXER_SAMPLE_RATE * 1000

    def test_leading_and_trailing_silence_is_trimmed(self):
        trimmed = filler_clips._trim_edge_silence(
            self._pcm((400, 0), (500, 8000), (300, 0))
        )
        # The speech plus the edge padding either side, not the 700 ms of air.
        assert 500 <= self._ms(trimmed) <= 500 + 2 * filler_clips._EDGE_PAD_MS + 20

    def test_all_silence_trims_to_nothing(self):
        assert filler_clips._trim_edge_silence(self._pcm((500, 0))) == b""

    @pytest.mark.parametrize(
        "text,ms,ok",
        [
            ("Hmm.", 600, True),
            ("Hmm.", 80, False),  # near-nothing
            ("Hmm.", 6000, False),  # a run-on generation
            ("Hmm. Mm. Hmm… Hmm… let me think. Um… Uh… Well… I mean…", 10500, True),
            ("[sighs] Okay.", 1500, True),  # tags don't count as characters
            ("That is a lot to take in, honestly.", 3200, True),
        ],
    )
    def test_plausible_duration(self, text, ms, ok):
        assert filler_clips._plausible_duration(text, ms) is ok
