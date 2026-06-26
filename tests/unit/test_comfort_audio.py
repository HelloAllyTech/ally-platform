"""Tests for the comfort-audio (ambient room tone) layer."""

import os
import wave
from types import SimpleNamespace

import pytest

from app.core.livekit import comfort_audio


def _scenario(comfort_audio_enabled):
    """A minimal scenario stub exposing prompt_data.comfort_audio_enabled."""
    return SimpleNamespace(
        prompt_data=SimpleNamespace(comfort_audio_enabled=comfort_audio_enabled)
    )


class TestIsComfortAudioEnabled:
    """Two gates: the global kill-switch AND the per-simulation opt-in."""

    @pytest.mark.unit
    def test_enabled_when_both_on(self, monkeypatch):
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", True)
        assert comfort_audio.is_comfort_audio_enabled(_scenario(True)) is True

    @pytest.mark.unit
    def test_disabled_by_default_when_scenario_opt_out(self, monkeypatch):
        """Global on but the per-sim opt-in is off (the default) → no tone."""
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", True)
        assert comfort_audio.is_comfort_audio_enabled(_scenario(False)) is False

    @pytest.mark.unit
    def test_disabled_when_global_off(self, monkeypatch):
        """Global kill-switch wins even when the per-sim toggle is on."""
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", False)
        assert comfort_audio.is_comfort_audio_enabled(_scenario(True)) is False

    @pytest.mark.unit
    def test_disabled_when_no_scenario(self, monkeypatch):
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", True)
        assert comfort_audio.is_comfort_audio_enabled(None) is False

    @pytest.mark.unit
    def test_disabled_when_no_prompt_data(self, monkeypatch):
        monkeypatch.setattr(comfort_audio.settings, "COMFORT_AUDIO_ENABLED", True)
        assert comfort_audio.is_comfort_audio_enabled(SimpleNamespace()) is False


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
    def test_default_sample_rate_matches_mixer(self):
        """Default rate must be 48 kHz to match the BackgroundAudioPlayer mixer/
        source; a mismatch makes the room tone resample to the wrong character."""
        path = comfort_audio.synthesize_comfort_clip(duration_s=0.1)
        try:
            with wave.open(path, "rb") as wav:
                assert wav.getframerate() == 48000
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


class TestComfortAmbientSource:
    """The in-memory looping ambient iterator fed to BackgroundAudioPlayer."""

    @pytest.mark.unit
    def test_infinite_inmemory_loop_of_48k_frames(self):
        """Yields 48 kHz mono frames and loops forever (never exhausts), so the
        shared mixer can't time it out and drop the comfort stream mid-session."""
        import asyncio

        src = comfort_audio.comfort_ambient_source(
            duration_s=0.2, sample_rate=48000, frame_samples=4800
        )
        assert src is not None

        async def take(n):
            out = []
            async for frame in src:
                out.append(frame)
                if len(out) >= n:
                    break
            return out

        # 0.2s @ 48k / 4800 = 2 base frames; pulling 5 proves it loops (infinite).
        frames = asyncio.run(take(5))
        assert len(frames) == 5
        for frame in frames:
            assert frame.sample_rate == 48000
            assert frame.num_channels == 1
            assert frame.samples_per_channel == 4800


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
