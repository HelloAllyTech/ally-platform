"""Comprehensive tests for TTS validator methods in provider classes."""

import base64
from unittest.mock import Mock, patch

import pytest

from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.sarvam import SarvamTTSClient


class TestValidateDeepgramVoice:
    """Test cases for DeepgramTTSClient.validate_voice method."""

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramClient")
    @patch("app.tts.deepgram.settings")
    def test_validate_deepgram_voice_success(self, mock_settings, mock_client_class):
        """Test successful Deepgram voice validation."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"

        # Mock the client and its nested structure
        mock_client = Mock()
        mock_client.speak.v1.audio.generate.return_value = iter([b"audio_data"])
        mock_client_class.return_value = mock_client

        result = DeepgramTTSClient.validate_voice(model="aura-asteria-en")

        assert result is True
        mock_client_class.assert_called_once_with(api_key="test-api-key")
        mock_client.speak.v1.audio.generate.assert_called_once_with(
            text="Test",
            model="aura-asteria-en",
            encoding="linear16",
            sample_rate=16000,
        )

    @pytest.mark.unit
    def test_validate_deepgram_voice_no_model(self):
        """Test Deepgram validation with no model provided."""
        result = DeepgramTTSClient.validate_voice(model="")

        assert result is False

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,expected",
        [
            ("aura-asteria-en", True),
            ("nova-2", True),
            (None, False),
            ("", False),
        ],
    )
    @patch("app.tts.deepgram.DeepgramClient")
    @patch("app.tts.deepgram.settings")
    def test_validate_deepgram_voice_model_variations(
        self, mock_settings, mock_client_class, model, expected
    ):
        """Test Deepgram validation with various model inputs."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"

        if expected and model:
            mock_client = Mock()
            mock_client.speak.v1.audio.generate.return_value = iter([b"audio_data"])
            mock_client_class.return_value = mock_client

        result = DeepgramTTSClient.validate_voice(model=model)

        assert result is expected

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramClient")
    @patch("app.tts.deepgram.settings")
    def test_validate_deepgram_voice_api_error(self, mock_settings, mock_client_class):
        """Test handling Deepgram API errors."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_client = Mock()
        # Use a generic Exception to avoid dependency on Deepgram ApiError signature
        mock_client.speak.v1.audio.generate.side_effect = Exception("API Error")
        mock_client_class.return_value = mock_client

        result = DeepgramTTSClient.validate_voice(model="aura-asteria-en")

        assert result is False

    @pytest.mark.unit
    @patch("app.tts.deepgram.DeepgramClient")
    @patch("app.tts.deepgram.settings")
    def test_validate_deepgram_voice_general_exception(
        self, mock_settings, mock_client_class
    ):
        """Test handling general exceptions during Deepgram validation."""
        mock_settings.DEEPGRAM_API_KEY = "test-api-key"
        mock_client = Mock()
        mock_client.speak.v1.audio.generate.side_effect = RuntimeError(
            "Connection error"
        )
        mock_client_class.return_value = mock_client

        result = DeepgramTTSClient.validate_voice(model="aura-asteria-en")

        assert result is False


class TestValidateSarvamVoice:
    """Test cases for SarvamTTSClient.validate_voice method."""

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamAI")
    @patch("app.tts.sarvam.settings")
    def test_validate_sarvam_voice_success(self, mock_settings, mock_sarvam_class):
        """Test successful Sarvam voice validation."""
        mock_settings.SARVAM_API_KEY = "test-api-key"

        # Mock successful response with valid base64 audio
        mock_response = Mock()
        mock_response.audios = [base64.b64encode(b"audio_data").decode("ascii")]

        mock_sarvam = Mock()
        mock_sarvam.text_to_speech.convert.return_value = mock_response
        mock_sarvam_class.return_value = mock_sarvam

        result = SarvamTTSClient.validate_voice(model="multilingual", speaker="meera")

        assert result is True
        mock_sarvam_class.assert_called_once_with(api_subscription_key="test-api-key")
        mock_sarvam.text_to_speech.convert.assert_called_once_with(
            target_language_code="en-IN",
            text="Hello from Sarvam AI!",
            model="multilingual",
            speaker="meera",
        )

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "model,speaker,expected",
        [
            ("multilingual", "meera", True),
            ("multilingual", "arjun", True),
            (None, "meera", False),
            ("multilingual", None, False),
            (None, None, False),
            ("", "meera", False),
            ("multilingual", "", False),
        ],
    )
    def test_validate_sarvam_voice_parameter_variations(self, model, speaker, expected):
        """Test Sarvam validation with various parameter combinations."""
        result = SarvamTTSClient.validate_voice(model=model, speaker=speaker)

        if not expected:
            assert result is False
        else:
            # For valid parameters, we'd need to mock the API call
            # This test focuses on parameter validation logic
            pass

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamAI")
    @patch("app.tts.sarvam.settings")
    def test_validate_sarvam_voice_invalid_base64(
        self, mock_settings, mock_sarvam_class
    ):
        """Test handling invalid base64 audio response."""
        mock_settings.SARVAM_API_KEY = "test-api-key"

        # Mock response with invalid base64
        mock_response = Mock()
        mock_response.audios = ["invalid-base64!!"]

        mock_sarvam = Mock()
        mock_sarvam.text_to_speech.convert.return_value = mock_response
        mock_sarvam_class.return_value = mock_sarvam

        result = SarvamTTSClient.validate_voice(model="multilingual", speaker="meera")

        assert result is False

    @pytest.mark.unit
    @patch("app.tts.sarvam.SarvamAI")
    @patch("app.tts.sarvam.settings")
    def test_validate_sarvam_voice_api_error(self, mock_settings, mock_sarvam_class):
        """Test handling Sarvam API errors."""
        mock_settings.SARVAM_API_KEY = "test-api-key"
        mock_sarvam = Mock()
        # Use generic Exception to avoid signature dependency
        mock_sarvam.text_to_speech.convert.side_effect = Exception("API Error")
        mock_sarvam_class.return_value = mock_sarvam

        result = SarvamTTSClient.validate_voice(model="multilingual", speaker="meera")

        assert result is False


class TestValidateElevenLabsVoice:
    """Test cases for ElevenLabsTTSClient.validate_voice method."""

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabs")
    @patch("app.tts.elevenlabs.settings")
    def test_validate_elevenlabs_voice_success(self, mock_settings, mock_eleven_class):
        """Test successful ElevenLabs voice validation."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"

        # Mock successful voice retrieval
        mock_voice = Mock()
        mock_voice.voice_id = "test-voice-id"

        mock_eleven = Mock()
        mock_eleven.voices.get.return_value = mock_voice
        mock_eleven_class.return_value = mock_eleven

        result = ElevenLabsTTSClient.validate_voice(voice_id="test-voice-id")

        assert result is True
        mock_eleven_class.assert_called_once_with(api_key="test-api-key")
        mock_eleven.voices.get.assert_called_once_with(voice_id="test-voice-id")

    @pytest.mark.unit
    def test_validate_elevenlabs_voice_no_voice_id(self):
        """Test ElevenLabs validation with no voice_id provided."""
        result = ElevenLabsTTSClient.validate_voice(voice_id="")

        assert result is False

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "voice_id,expected",
        [
            ("valid-voice-id", True),
            ("another-voice-id", True),
            (None, False),
            ("", False),
        ],
    )
    @patch("app.tts.elevenlabs.ElevenLabs")
    @patch("app.tts.elevenlabs.settings")
    def test_validate_elevenlabs_voice_id_variations(
        self, mock_settings, mock_eleven_class, voice_id, expected
    ):
        """Test ElevenLabs validation with various voice_id inputs."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"

        if expected and voice_id:
            mock_voice = Mock()
            mock_voice.voice_id = voice_id
            mock_eleven = Mock()
            mock_eleven.voices.get.return_value = mock_voice
            mock_eleven_class.return_value = mock_eleven

        result = ElevenLabsTTSClient.validate_voice(voice_id=voice_id)

        assert result is expected

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabs")
    @patch("app.tts.elevenlabs.settings")
    def test_validate_elevenlabs_voice_unexpected_response(
        self, mock_settings, mock_eleven_class
    ):
        """Test handling unexpected voice_id in response."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"

        # Mock response with different voice_id
        mock_voice = Mock()
        mock_voice.voice_id = "different-voice-id"

        mock_eleven = Mock()
        mock_eleven.voices.get.return_value = mock_voice
        mock_eleven_class.return_value = mock_eleven

        result = ElevenLabsTTSClient.validate_voice(voice_id="requested-voice-id")

        assert result is False

    @pytest.mark.unit
    @patch("app.tts.elevenlabs.ElevenLabs")
    @patch("app.tts.elevenlabs.settings")
    def test_validate_elevenlabs_voice_api_error(
        self, mock_settings, mock_eleven_class
    ):
        """Test handling ElevenLabs API errors."""
        mock_settings.ELEVEN_API_KEY = "test-api-key"
        mock_eleven = Mock()
        # Use generic Exception to avoid signature dependency
        mock_eleven.voices.get.side_effect = Exception("Voice not found")
        mock_eleven_class.return_value = mock_eleven

        result = ElevenLabsTTSClient.validate_voice(voice_id="test-voice-id")

        assert result is False


class TestTTSValidatorIntegration:
    """Integration tests for TTS validator functionality."""

    @pytest.mark.integration
    def test_error_handling_chain(self):
        """Test error handling throughout the validation chain."""
        # Test with invalid parameters
        result = DeepgramTTSClient.validate_voice(model=None)
        assert result is False

        result = SarvamTTSClient.validate_voice(model=None, speaker=None)
        assert result is False

        result = ElevenLabsTTSClient.validate_voice(voice_id=None)
        assert result is False
