"""Tests for parallel filler/back-channel clip synthesis.

``synthesize_filler_clips`` fans out one ``tts.synthesize()`` per phrase with
``asyncio.gather`` (was a sequential loop). These assert the two contracts that
matter to callers: input ORDER is preserved in the returned ``(phrase, path)``
pairs, and a per-phrase failure (or empty/no-audio phrase) is skipped rather
than raised — a filler must never break a session.
"""

from types import SimpleNamespace

import pytest

from app.core.livekit.filler_audio import cleanup_clips, synthesize_filler_clips


class _FakeFrame:
    def __init__(self, data):
        self.data = data
        self.sample_rate = 24000
        self.num_channels = 1


class _FakeEvent:
    def __init__(self, frame):
        self.frame = frame


class _FakeStream:
    """Async-iterable TTS stream; optionally raises mid-iteration."""

    def __init__(self, frames, raise_exc=False):
        self._frames = frames
        self._raise = raise_exc
        self._i = 0
        self.closed = False

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
        self.closed = True


class _FakeInputStream(_FakeStream):
    """stream()-style input: accepts pushed text, then yields frames."""

    def __init__(self, frames):
        super().__init__(frames)
        self.pushed = []

    def push_text(self, text):
        self.pushed.append(text)

    def flush(self):
        pass

    def end_input(self):
        pass


class _FakeTTS:
    def __init__(self, fail_phrases=(), empty_phrases=(), stream_rescues=False):
        self.fail_phrases = set(fail_phrases)
        self.empty_phrases = set(empty_phrases)
        # When True, the websocket-style stream() path produces audio even for
        # phrases whose one-shot synthesize() failed — the Sarvam shape.
        self.stream_rescues = stream_rescues
        self.calls = []
        self.stream_calls = 0

    def synthesize(self, phrase):
        self.calls.append(phrase)
        if phrase in self.fail_phrases:
            return _FakeStream([], raise_exc=True)
        if phrase in self.empty_phrases:
            return _FakeStream([])  # yields no frames -> skipped
        return _FakeStream([_FakeFrame(b"\x01\x00\x02\x00")])

    def stream(self):
        self.stream_calls += 1
        frames = [_FakeFrame(b"\x03\x00\x04\x00")] if self.stream_rescues else []
        return _FakeInputStream(frames)


def _client(tts):
    """A client exposing the isolated-clip-TTS contract."""
    return SimpleNamespace(create_clip_tts=lambda: tts)


class TestSynthesizeFillerClips:
    @pytest.mark.unit
    async def test_returns_empty_without_isolated_instance(self):
        # No create_clip_tts, or one that yields None: clips are SKIPPED —
        # never synthesized on the session's shared instance, whose error
        # budget closes the whole AgentSession (prod Marathi outage).
        legacy_client = SimpleNamespace(tts_instance=_FakeTTS())
        assert await synthesize_filler_clips(legacy_client, ["a", "b"]) == []
        none_client = SimpleNamespace(create_clip_tts=lambda: None)
        assert await synthesize_filler_clips(none_client, ["a", "b"]) == []

    @pytest.mark.unit
    async def test_returns_empty_for_no_phrases(self):
        assert await synthesize_filler_clips(_client(_FakeTTS()), []) == []

    @pytest.mark.unit
    async def test_stream_fallback_rescues_broken_oneshot(self):
        # Sarvam shape: one-shot synthesize() is broken (raises/empty) but the
        # websocket stream() path works — the clip must come from stream().
        tts = _FakeTTS(fail_phrases={"a"}, empty_phrases={"b"}, stream_rescues=True)
        clips = await synthesize_filler_clips(_client(tts), ["a", "b"])
        try:
            assert [phrase for phrase, _ in clips] == ["a", "b"]
            assert tts.stream_calls == 2
        finally:
            cleanup_clips([path for _, path in clips])

    @pytest.mark.unit
    async def test_preserves_order_and_skips_failures(self):
        # "   " is empty (skipped), "bad" raises mid-synth (skipped), "quiet"
        # yields no audio (skipped); the survivors keep their input order.
        tts = _FakeTTS(fail_phrases={"bad"}, empty_phrases={"quiet"})
        client = _client(tts)
        phrases = ["a", "   ", "bad", "b", "quiet", "c"]

        clips = await synthesize_filler_clips(client, phrases)
        try:
            assert [phrase for phrase, _ in clips] == ["a", "b", "c"]
            # Every non-empty phrase was attempted (parallel fan-out).
            assert set(tts.calls) == {"a", "bad", "b", "quiet", "c"}
        finally:
            cleanup_clips([path for _, path in clips])

    @pytest.mark.unit
    async def test_all_success_returns_all_in_order(self):
        tts = _FakeTTS()
        client = _client(tts)
        phrases = ["one", "two", "three"]

        clips = await synthesize_filler_clips(client, phrases)
        try:
            assert [phrase for phrase, _ in clips] == phrases
        finally:
            cleanup_clips([path for _, path in clips])
