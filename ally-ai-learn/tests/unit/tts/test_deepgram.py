import asyncio
from unittest.mock import MagicMock, patch

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

    # synthesize() returns the audio stream itself (an async generator), which
    # the client iterates chunk by chunk under asyncio.wait_for.
    async def slow_stream(*args, **kwargs):
        await asyncio.sleep(0.1)
        yield b"audio_chunk"

    mock_tts_instance.synthesize = MagicMock(side_effect=slow_stream)
    client._tts_instance = mock_tts_instance

    # Time out the first chunk. Close the pending __anext__ awaitable, as the
    # real wait_for would cancel it, so no never-awaited warning leaks.
    def time_out(awaitable, timeout):
        awaitable.close()
        raise asyncio.TimeoutError

    mock_wait_for.side_effect = time_out

    with pytest.raises(asyncio.TimeoutError):
        async for _ in client.synthesize("Hello"):
            pass

    # Assert that asyncio.wait_for was called with the correct timeout
    mock_wait_for.assert_called_once()
    assert mock_wait_for.call_args[1]["timeout"] == 30.0
