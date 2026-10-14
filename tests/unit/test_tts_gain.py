"""GainTTS: the fixed boost for ElevenLabs v4 voices and its peak limiter."""

from unittest.mock import Mock, patch

import numpy as np
import pytest

from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.gain import _LIMIT, GainState, GainTTS, db_to_linear


def _pcm(*samples: int) -> bytes:
    return np.array(samples, dtype=np.int16).tobytes()


def _samples(b: bytes) -> list[int]:
    return np.frombuffer(b, dtype=np.int16).tolist()


@pytest.mark.unit
class TestGainState:
    def test_scales_quiet_audio_by_the_full_gain(self):
        state = GainState(db_to_linear(6.0))  # ~1.995x
        out = _samples(state.apply(_pcm(1000, -2000, 0)))
        assert out == [1995, -3991, 0]

    def test_never_pushes_a_sample_past_the_limit(self):
        state = GainState(db_to_linear(8.0))  # ~2.51x
        loud = _pcm(20000, -20000)  # 2.51x would be 50k: must be limited
        out = _samples(state.apply(loud))
        assert max(abs(v) for v in out) <= _LIMIT
        assert out[0] == pytest.approx(_LIMIT, abs=1)

    def test_gain_only_steps_down_within_a_synthesis(self):
        state = GainState(db_to_linear(8.0))
        state.apply(_pcm(20000))  # a loud peak pins the effective gain to 1.6x
        quiet_after = _samples(state.apply(_pcm(1000)))
        assert quiet_after == [1600]  # not back to 2.51x

    def test_unity_gain_and_empty_input_pass_through(self):
        assert GainState(1.0).apply(_pcm(123, -456)) == _pcm(123, -456)
        assert GainState(2.0).apply(b"") == b""

    def test_audio_already_at_ceiling_passes_through_untouched(self):
        state = GainState(db_to_linear(8.0))
        hot = _pcm(32700, -32700)
        assert state.apply(hot) == hot


def _fake_base_tts():
    base = Mock()
    base.capabilities = Mock()
    base.sample_rate = 22050
    base.num_channels = 1
    base.on = Mock()
    base.off = Mock()
    return base


@pytest.mark.unit
class TestElevenLabsGainWiring:
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_v4_is_wrapped_in_gain_over_stream_adapter(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate
    ):
        mock_settings.ELEVEN_API_KEY = "k"
        mock_settings.ELEVENLABS_V4_GAIN_DB = 8.0
        mock_validate.return_value = True
        mock_tts_class.return_value = _fake_base_tts()
        adapter = _fake_base_tts()
        mock_stream_adapter.return_value = adapter
        client = ElevenLabsTTSClient(
            model="eleven_v4", voice_id="v", language_code="hi-IN"
        )
        inst = client.tts_instance
        assert isinstance(inst, GainTTS)
        assert inst.wrapped_tts is adapter
        assert inst.gain_db == 8.0
        assert client._base_tts is mock_tts_class.return_value

    @pytest.mark.parametrize("model", ["eleven_v3", "eleven_multilingual_v2"])
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_non_v4_models_get_no_gain(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate, model
    ):
        mock_settings.ELEVEN_API_KEY = "k"
        mock_settings.ELEVENLABS_V4_GAIN_DB = 8.0
        mock_validate.return_value = True
        mock_tts_class.return_value = _fake_base_tts()
        mock_stream_adapter.return_value = _fake_base_tts()
        client = ElevenLabsTTSClient(model=model, voice_id="v", language_code="en-IN")
        assert not isinstance(client.tts_instance, GainTTS)

    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.agents_tts.StreamAdapter")
    @patch("livekit.plugins.elevenlabs.TTS")
    @patch("app.tts.elevenlabs.settings")
    def test_zero_gain_setting_disables_the_wrapper(
        self, mock_settings, mock_tts_class, mock_stream_adapter, mock_validate
    ):
        mock_settings.ELEVEN_API_KEY = "k"
        mock_settings.ELEVENLABS_V4_GAIN_DB = 0.0
        mock_validate.return_value = True
        mock_tts_class.return_value = _fake_base_tts()
        adapter = _fake_base_tts()
        mock_stream_adapter.return_value = adapter
        client = ElevenLabsTTSClient(
            model="eleven_v4_turbo", voice_id="v", language_code="en-IN"
        )
        assert client.tts_instance is adapter
