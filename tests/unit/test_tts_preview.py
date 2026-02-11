"""Tests for generate_preview() across all TTS providers."""

import base64
from unittest.mock import AsyncMock, Mock, patch

import pytest

from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.google import GoogleTTSClient
from app.tts.hume import HumeTTSClient
from app.tts.sarvam import SarvamTTSClient


class TestDeepgramGeneratePreview:
    """Test Deepgram generate_preview."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch("app.tts.deepgram.DeepgramTTSClient.validate_voice")
    @patch("app.tts.deepgram.DeepgramClient")
    @patch("app.tts.deepgram.settings")
    async def test_generate_preview_success(
        self, mock_settings, mock_client_class, mock_validate
    ):
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_validate.return_value = True

        fake_pcm = b"\x00\x01" * 500
        mock_client = Mock()
        mock_client.speak.v1.audio.generate.return_value = iter([fake_pcm])
        mock_client_class.return_value = mock_client

        client = DeepgramTTSClient(
            model="aura-asteria-en", language_code="en-US", api_key="test-api-key"
        )

        with patch("pydub.AudioSegment") as mock_audio_seg:
            mock_audio = Mock()
            mock_audio_seg.from_raw.return_value = mock_audio

            def mock_export(buffer, format, bitrate):
                buffer.write(b"fake-mp3")

            mock_audio.export.side_effect = mock_export

            result = await client.generate_preview(text="Hello")

        assert isinstance(result, bytes)
        assert len(result) > 0
        mock_client.speak.v1.audio.generate.assert_called_once_with(
            text="Hello",
            model="aura-asteria-en",
            encoding="linear16",
            sample_rate=24000,
        )


class TestElevenLabsGeneratePreview:
    """Test ElevenLabs generate_preview."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch("app.tts.elevenlabs.ElevenLabsTTSClient.validate_voice")
    @patch("app.tts.elevenlabs.ElevenLabs")
    @patch("app.tts.elevenlabs.settings")
    async def test_generate_preview_success(
        self, mock_settings, mock_eleven_class, mock_validate
    ):
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_validate.return_value = True

        fake_mp3 = b"fake-mp3-chunk-1" + b"fake-mp3-chunk-2"
        mock_eleven = Mock()
        mock_eleven.text_to_speech.convert.return_value = iter(
            [b"fake-mp3-chunk-1", b"fake-mp3-chunk-2"]
        )
        mock_eleven_class.return_value = mock_eleven

        client = ElevenLabsTTSClient(
            model="eleven_turbo_v2_5",
            voice_id="test-voice-id",
            language_code="en-US",
            api_key="test-api-key",
        )

        result = await client.generate_preview(text="Hello")

        assert result == fake_mp3
        mock_eleven.text_to_speech.convert.assert_called_once_with(
            voice_id="test-voice-id",
            model_id="eleven_turbo_v2_5",
            text="Hello",
            output_format="mp3_44100_128",
        )


class TestSarvamGeneratePreview:
    """Test Sarvam generate_preview."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch("app.tts.sarvam.SarvamTTSClient.validate_voice")
    @patch("app.tts.sarvam.SarvamAI")
    @patch("app.tts.sarvam.settings")
    async def test_generate_preview_success(
        self, mock_settings, mock_sarvam_class, mock_validate
    ):
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_validate.return_value = True

        fake_wav = b"RIFF" + b"\x00" * 100
        mock_response = Mock()
        mock_response.audios = [base64.b64encode(fake_wav).decode("ascii")]
        mock_sarvam = Mock()
        mock_sarvam.text_to_speech.convert.return_value = mock_response
        mock_sarvam_class.return_value = mock_sarvam

        client = SarvamTTSClient(
            model="bulbul:v2",
            speaker="meera",
            language_code="en-IN",
            api_key="test-api-key",
        )

        with patch("pydub.AudioSegment") as mock_audio_seg:
            mock_audio = Mock()
            mock_audio_seg.from_wav.return_value = mock_audio

            def mock_export(buffer, format, bitrate):
                buffer.write(b"fake-mp3")

            mock_audio.export.side_effect = mock_export

            result = await client.generate_preview(text="Hello")

        assert isinstance(result, bytes)
        assert len(result) > 0
        mock_sarvam.text_to_speech.convert.assert_called_once_with(
            target_language_code="en-IN",
            text="Hello",
            model="bulbul:v2",
            speaker="meera",
        )


class TestGoogleGeneratePreview:
    """Test Google generate_preview."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch("app.tts.google.GoogleTTSClient.validate_voice")
    @patch("app.tts.google.settings")
    async def test_generate_preview_success(self, mock_settings, mock_validate):
        mock_settings.GOOGLE_APPLICATION_CREDENTIALS = None
        mock_validate.return_value = True

        client = GoogleTTSClient(
            language_code="en-US",
            gender="female",
            voice_name="en-US-Chirp3-HD-Aoede",
        )

        fake_mp3 = b"fake-mp3-bytes"

        with patch("google.cloud.texttospeech") as mock_tts_module:
            mock_client = Mock()
            mock_response = Mock()
            mock_response.audio_content = fake_mp3
            mock_client.synthesize_speech.return_value = mock_response
            mock_tts_module.TextToSpeechClient.return_value = mock_client

            mock_tts_module.SynthesisInput.return_value = Mock()
            mock_tts_module.VoiceSelectionParams.return_value = Mock()
            mock_tts_module.AudioConfig.return_value = Mock()
            mock_tts_module.AudioEncoding.MP3 = "MP3"
            mock_tts_module.SsmlVoiceGender.FEMALE = "FEMALE"
            mock_tts_module.SsmlVoiceGender.NEUTRAL = "NEUTRAL"

            result = await client.generate_preview(text="Hello")

        assert result == fake_mp3
        mock_client.synthesize_speech.assert_called_once()


class TestHumeGeneratePreview:
    """Test Hume generate_preview."""

    @pytest.mark.unit
    @pytest.mark.asyncio
    @patch("app.tts.hume.HumeTTSClient.validate_voice")
    @patch("app.tts.hume.settings")
    async def test_generate_preview_success(self, mock_settings, mock_validate):
        mock_settings.HUME_API_KEY = "test-api-key"
        mock_validate.return_value = True

        client = HumeTTSClient(
            voice_name="Ava Song",
            voice_provider="HUME_AI",
            api_key="test-api-key",
        )

        # Simulate WAV response (most common path)
        fake_wav = b"RIFF" + b"\x00" * 100
        fake_wav_b64 = base64.b64encode(fake_wav).decode("ascii")

        with patch("hume.AsyncHumeClient") as mock_hume_class, \
             patch("pydub.AudioSegment") as mock_audio_seg:

            mock_client = AsyncMock()
            mock_generation = Mock()
            mock_generation.audio = fake_wav_b64
            mock_result = Mock()
            mock_result.generations = [mock_generation]
            mock_client.tts.synthesize_json.return_value = mock_result
            mock_hume_class.return_value = mock_client

            mock_audio = Mock()
            mock_audio_seg.from_wav.return_value = mock_audio

            def mock_export(buffer, format, bitrate):
                buffer.write(b"fake-mp3")

            mock_audio.export.side_effect = mock_export

            result = await client.generate_preview(text="Hello")

        assert isinstance(result, bytes)
        assert len(result) > 0
        mock_client.tts.synthesize_json.assert_called_once()
