from unittest.mock import MagicMock, patch

import pytest
from livekit.plugins.elevenlabs import VoiceSettings

from app.tts.elevenlabs import ElevenLabsTTSClient


@pytest.mark.unit
@patch("app.tts.elevenlabs.settings")
@patch("livekit.plugins.elevenlabs.TTS")
def test_v4_model_defaults_are_not_overridden(MockElevenLabsTTS, mock_settings):
    # Arrange: Initialize with a v4 model, which should set high stability defaults.
    mock_settings.ELEVEN_API_KEY = "test_key"
    mock_base_tts = MagicMock()

    # Set initial voice settings on the mock
    initial_settings = VoiceSettings(stability=0.95, similarity_boost=0.75)
    # The options object and its voice_settings attribute might not exist on the mock
    # so we create them.
    mock_base_tts.options = MagicMock()
    mock_base_tts.options.voice_settings = initial_settings

    MockElevenLabsTTS.return_value = mock_base_tts

    client = ElevenLabsTTSClient(
        model="eleven_multilingual_v4_turbo",
        voice_id="test_voice",
        language_code="en-US",
    )

    # Act: Access tts_instance to trigger initialization
    # This will set the high-stability defaults.
    client.tts_instance

    # Assert initial state from the mock setup
    # This confirms the tts_instance property set the correct values
    mock_base_tts.update_options.assert_called_with(voice_settings=initial_settings)

    # Act: Apply a new parameter (speed), which triggers the buggy behavior
    # in _apply_parameters_dict
    client._apply_parameters_dict({"speed": 1.1})

    # Assert: Check that update_options was called again, but this time
    # it should have preserved the high stability and similarity, not
    # reverted to the low defaults.

    # The bug would revert settings to VoiceSettings(stability=0.71,
    # similarity_boost=0.5)
    # The correct behavior is to preserve them: (stability=0.95, similarity_boost=0.75)

    # Get the arguments from the last call to update_options
    final_call_args, final_call_kwargs = mock_base_tts.update_options.call_args
    final_settings = final_call_kwargs.get("voice_settings")

    assert final_settings is not None

    # This is the assertion for the corrected behavior. It will fail now.
    assert final_settings.stability == 0.95, "Stability should be preserved"
    assert (
        final_settings.similarity_boost == 0.75
    ), "Similarity boost should be preserved"
    assert final_settings.speed == 1.1, "Speed should be updated"
