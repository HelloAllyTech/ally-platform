"""Tests for the comfort-audio (ambient room tone) layer."""

import os
import wave

import pytest

from app.core.livekit import comfort_audio


class TestIsComfortAudioEnabled:
    """Gate driven by the single global flag."""

    @pytest.mark.unit
    def test_enabled_by_default(self, monkeypatch):
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", True)
        assert comfort_audio.is_comfort_audio_enabled() is True

    @pytest.mark.unit
    def test_disabled_when_flag_off(self, monkeypatch):
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", False)
        assert comfort_audio.is_comfort_audio_enabled() is False


class TestSynthesizeComfortClip:
    """The generated room-tone WAV."""

    @pytest.mark.unit
    def test_produces_valid_wav(self):
        path = comfort_audio.synthesize_comfort_clip(duration_s=0.5, sample_rate=24000)
        try:
            assert path is not None
            assert os.path.exists(path)
            with wave.open(path, "rb") as wav:
                assert wav.getnchannels() == 1
                assert wav.getsampwidth() == 2  # int16 PCM
                assert wav.getframerate() == 24000
                assert wav.getnframes() == int(0.5 * 24000)
        finally:
            comfort_audio.cleanup_clip(path)

    @pytest.mark.unit
    def test_normalized_to_expected_peak(self):
        """Filtered noise is normalized to a predictable source peak so the
        playback volume control is meaningful (the low-pass would otherwise
        attenuate it to near silence)."""
        import struct

        path = comfort_audio.synthesize_comfort_clip(duration_s=0.5)
        try:
            with wave.open(path, "rb") as wav:
                raw = wav.readframes(wav.getnframes())
            samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
            peak = max(abs(s) for s in samples)
            # Target peak is ~6553 (20% of int16 full scale); allow rounding.
            assert 6500 <= peak <= 6553
        finally:
            comfort_audio.cleanup_clip(path)

    @pytest.mark.unit
    def test_deterministic(self):
        """Same params yield identical audio (fixed RNG seed)."""
        p1 = comfort_audio.synthesize_comfort_clip(duration_s=0.3)
        p2 = comfort_audio.synthesize_comfort_clip(duration_s=0.3)
        try:
            with wave.open(p1, "rb") as w1, wave.open(p2, "rb") as w2:
                assert w1.readframes(w1.getnframes()) == w2.readframes(w2.getnframes())
        finally:
            comfort_audio.cleanup_clip(p1)
            comfort_audio.cleanup_clip(p2)

    @pytest.mark.unit
    def test_returns_none_on_failure(self, monkeypatch):
        """Synthesis never raises — failures yield None (no comfort audio)."""

        def boom(*_a, **_k):
            raise RuntimeError("disk full")

        monkeypatch.setattr(comfort_audio.tempfile, "mkstemp", boom)
        assert comfort_audio.synthesize_comfort_clip(duration_s=0.1) is None


class TestCleanupClip:
    @pytest.mark.unit
    def test_removes_file(self):
        path = comfort_audio.synthesize_comfort_clip(duration_s=0.1)
        assert os.path.exists(path)
        comfort_audio.cleanup_clip(path)
        assert not os.path.exists(path)

    @pytest.mark.unit
    def test_handles_none_and_missing(self):
        # Neither should raise.
        comfort_audio.cleanup_clip(None)
        comfort_audio.cleanup_clip("/nonexistent/path/comfort_xyz.wav")
