from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from app.tts.sarvam import SarvamTTSClient


@pytest.mark.asyncio
async def test_sarvam_tts_client_filters_whitespace():
    """
    Verify that SarvamTTSClient filters whitespace-only text through
    the _WhitespaceFilterWrapper.
    """
    with patch("livekit.plugins.sarvam.TTS") as MockSarvamTTS:
        mock_tts_instance = MagicMock()
        mock_tts_instance.push_text = AsyncMock()
        MockSarvamTTS.return_value = mock_tts_instance

        # Create the client
        client = SarvamTTSClient(
            model="test-model",
            speaker="test-speaker",
            language_code="en-IN",
        )

        # Access the tts_instance property to trigger wrapping
        tts_stream = client.tts_instance

        # Push whitespace, it should be filtered
        await tts_stream.push_text("   ")

        # Assert that the underlying push_text was NOT called
        mock_tts_instance.push_text.assert_not_called()

        # Push valid text, it should pass through
        await tts_stream.push_text("Hello")

        # Assert that the underlying push_text was called
        mock_tts_instance.push_text.assert_called_once_with("Hello")
