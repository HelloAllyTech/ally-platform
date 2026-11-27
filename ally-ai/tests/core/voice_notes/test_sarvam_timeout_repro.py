from unittest.mock import AsyncMock, patch

import pytest

from app.core.voice_notes.service import sarvam_transcribe


@pytest.mark.asyncio
async def test_sarvam_transcribe_uses_timeout_long_enough_for_29s_piece():
    captured_posts = []

    class FakeResponse:
        def raise_for_status(self):
            return None

        def json(self):
            return {"transcript": "hello", "language_code": "hi"}

    async_client_cm = AsyncMock()

    async def post_side_effect(*args, **kwargs):
        captured_posts.append({"args": args, "kwargs": kwargs})
        return FakeResponse()

    async_client_cm.__aenter__.return_value.post = AsyncMock(
        side_effect=post_side_effect
    )

    with patch(
        "app.core.voice_notes.service.httpx.AsyncClient", return_value=async_client_cm
    ):
        await sarvam_transcribe([b"fake-wav-bytes"])  # content irrelevant here

    assert captured_posts, "Expected a POST to Sarvam to be made"
    used_timeout = captured_posts[0]["kwargs"].get("timeout")

    # Sarvam's synchronous API can legitimately take ~30s for a 29s piece; the
    # client timeout must not be shorter than that.
    assert (
        used_timeout is not None and used_timeout >= 30
    ), f"Sarvam POST timeout too short: {used_timeout} (should be >= 30s)"
