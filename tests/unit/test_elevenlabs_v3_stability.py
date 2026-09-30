import unittest
from unittest.mock import MagicMock, patch

from app.tts.elevenlabs import ElevenLabsTTSClient


class TestElevenLabsV3Stability(unittest.TestCase):
    @patch("livekit.plugins.elevenlabs.TTS")
    def test_v3_model_sets_high_stability(self, MockElevenLabsTTS):
        # Arrange
        mock_base_tts = MagicMock()
        MockElevenLabsTTS.return_value = mock_base_tts

        client = ElevenLabsTTSClient(
            model="eleven_multilingual_v3",
            voice_id="test_voice",
            language_code="en-US",
        )

        # Act
        _ = client.tts_instance

        # Assert
        # Check that update_options was called with high stability settings
        mock_base_tts.update_options.assert_called_once()
        call_args, call_kwargs = mock_base_tts.update_options.call_args
        voice_settings = call_kwargs.get("voice_settings")
        self.assertIsNotNone(voice_settings)
        self.assertEqual(voice_settings.stability, 0.95)
        self.assertEqual(voice_settings.similarity_boost, 0.75)

    @patch("livekit.plugins.elevenlabs.TTS")
    def test_v2_model_does_not_set_stability(self, MockElevenLabsTTS):
        # Arrange
        mock_base_tts = MagicMock()
        MockElevenLabsTTS.return_value = mock_base_tts

        client = ElevenLabsTTSClient(
            model="eleven_multilingual_v2",
            voice_id="test_voice",
            language_code="en-US",
        )

        # Act
        _ = client.tts_instance

        # Assert
        # Check that update_options was not called
        mock_base_tts.update_options.assert_not_called()
