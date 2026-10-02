import unittest.mock

from app.core.config import settings
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient


@unittest.mock.patch("livekit.plugins.deepgram.TTS")
def test_deepgram_tts_client_uses_timeout(mock_tts):
    """Test that DeepgramTTSClient instantiates the underlying TTS with a timeout."""
    client = DeepgramTTSClient(model="nova-2", language_code="en-US")
    _ = client.tts_instance
    mock_tts.assert_called_with(
        model="nova-2",
        encoding="linear16",
        sample_rate=24000,
        api_key=settings.DEEPGRAM_API_KEY,
    )


@unittest.mock.patch("livekit.plugins.elevenlabs.TTS")
def test_elevenlabs_tts_client_uses_timeout(mock_tts):
    """Test that ElevenLabsTTSClient instantiates the underlying TTS with a timeout."""
    client = ElevenLabsTTSClient(
        model="eleven_turbo_v2", voice_id="123", language_code="en-US"
    )
    _ = client.tts_instance
    mock_tts.assert_called_with(
        voice_id="123",
        model="eleven_turbo_v2",
        api_key=settings.ELEVEN_API_KEY,
        inactivity_timeout=30.0,
    )
