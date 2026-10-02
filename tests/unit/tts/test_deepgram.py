import asyncio
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.tts.deepgram import DeepgramTTSClient


@pytest.mark.asyncio
@patch("app.tts.deepgram.asyncio.wait_for")
async def test_deepgram_tts_client_synthesize_timeout(mock_wait_for):
    client = DeepgramTTSClient(
        model="nova-2", language_code="en-US", api_key="fake-key"
    )

    # Mock the underlying deepgram.TTS instance
    mock_tts_instance = MagicMock()

    async def long_running_synthesize(*args, **kwargs):
        await asyncio.sleep(0.1)

        async def async_generator():
            yield b"audio_chunk"

        return async_generator()

    mock_tts_instance.synthesize = AsyncMock(side_effect=long_running_synthesize)
    client._tts_instance = mock_tts_instance

    # Make the mock_wait_for raise a TimeoutError
    mock_wait_for.side_effect = asyncio.TimeoutError

    with pytest.raises(asyncio.TimeoutError):
        async for _ in client.synthesize("Hello"):
            pass

    # Assert that asyncio.wait_for was called with the correct timeout
    mock_wait_for.assert_called_once()
    assert mock_wait_for.call_args[1]["timeout"] == 30.0
