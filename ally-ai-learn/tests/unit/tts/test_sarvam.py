import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.tts.sarvam import SarvamTTSClient


@pytest.mark.asyncio
@patch("app.tts.sarvam.sarvam.TTS")
async def test_whitespace_filter_wrapper(MockSarvamTTS):
    """Verify that whitespace-only text is not sent to the TTS instance."""
    mock_tts_instance = MagicMock()
    mock_tts_instance.push_text = AsyncMock()
    MockSarvamTTS.return_value = mock_tts_instance

    client = SarvamTTSClient(
        model="test-model",
        speaker="test-speaker",
        language_code="en-IN",
    )

    # Access the property to apply wrappers
    tts_wrapper = client.tts_instance

    # Test with valid text
    await tts_wrapper.push_text("Hello")
    mock_tts_instance.push_text.assert_called_once_with("Hello")

    # Test with empty string
    mock_tts_instance.push_text.reset_mock()
    await tts_wrapper.push_text("")
    mock_tts_instance.push_text.assert_not_called()

    # Test with whitespace-only string
    mock_tts_instance.push_text.reset_mock()
    await tts_wrapper.push_text("   ")
    mock_tts_instance.push_text.assert_not_called()

    # Test with None
    mock_tts_instance.push_text.reset_mock()
    await tts_wrapper.push_text(None)
    mock_tts_instance.push_text.assert_not_called()
