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


class _FakeTTS:
    def __init__(self, fail_phrases=(), empty_phrases=()):
        self.fail_phrases = set(fail_phrases)
        self.empty_phrases = set(empty_phrases)
        self.calls = []

    def synthesize(self, phrase):
        self.calls.append(phrase)
        if phrase in self.fail_phrases:
            return _FakeStream([], raise_exc=True)
        if phrase in self.empty_phrases:
            return _FakeStream([])  # yields no frames -> skipped
        return _FakeStream([_FakeFrame(b"\x01\x00\x02\x00")])


class TestSynthesizeFillerClips:
    @pytest.mark.unit
    async def test_returns_empty_without_tts_instance(self):
        client = SimpleNamespace(tts_instance=None)
        assert await synthesize_filler_clips(client, ["a", "b"]) == []

    @pytest.mark.unit
    async def test_returns_empty_for_no_phrases(self):
        client = SimpleNamespace(tts_instance=_FakeTTS())
        assert await synthesize_filler_clips(client, []) == []

    @pytest.mark.unit
    async def test_preserves_order_and_skips_failures(self):
        # "   " is empty (skipped), "bad" raises mid-synth (skipped), "quiet"
        # yields no audio (skipped); the survivors keep their input order.
        tts = _FakeTTS(fail_phrases={"bad"}, empty_phrases={"quiet"})
        client = SimpleNamespace(tts_instance=tts)
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
        client = SimpleNamespace(tts_instance=tts)
        phrases = ["one", "two", "three"]

        clips = await synthesize_filler_clips(client, phrases)
        try:
            assert [phrase for phrase, _ in clips] == phrases
        finally:
            cleanup_clips([path for _, path in clips])
