"""Tests for the voice preview API endpoint."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.dependencies import verify_token
from app.main import app


async def _mock_verify_token():
    """Override verify_token to bypass auth in tests."""
    return {"user_id": "test-user", "valid": True}


@pytest.fixture(autouse=True)
def override_auth():
    """Override the auth dependency for all tests in this module."""
    app.dependency_overrides[verify_token] = _mock_verify_token
    yield
    app.dependency_overrides.clear()


class TestVoicePreviewEndpoint:
    """Test cases for POST /api/v1/voice-preview/generate."""

    @pytest.mark.unit
    @pytest.mark.parametrize(
        "provider,config",
        [
            ("DEEPGRAM", {"model": "aura-asteria-en"}),
            ("ELEVENLABS", {"voice_id": "abc123", "model": "eleven_turbo_v2_5"}),
            ("SARVAM", {"model": "bulbul:v2", "speaker": "meera"}),
            ("GOOGLE", {"voice_name": "en-US-Chirp3-HD-Aoede"}),
            ("HUME", {"voice_name": "Ava Song", "voice_provider": "HUME_AI"}),
        ],
    )
    @patch("app.api.voice_preview.create_tts_client")
    def test_generate_preview_success(self, mock_create_tts, provider, config):
        mock_client = AsyncMock()
        mock_client.generate_preview.return_value = b"fake-mp3-bytes"
        mock_create_tts.return_value = mock_client

        client = TestClient(app)
        resp = client.post(
            "/api/v1/voice-preview/generate",
            json={
                "provider": provider,
                "config": config,
                "text": "Hello",
                "language_code": "en-US",
            },
        )

        assert resp.status_code == 200
        assert resp.headers["content-type"] == "audio/mpeg"
        assert resp.headers["X-Provider"] == provider
        assert resp.content == b"fake-mp3-bytes"
        mock_create_tts.assert_called_once_with(
            tts_config={"provider": provider, "config": config},
            language_code="en-US",
        )
        mock_client.generate_preview.assert_called_once_with(text="Hello")

    @pytest.mark.unit
    def test_generate_preview_no_auth_header_returns_403(self):
        """Without the auth override, missing token should return 403."""
        app.dependency_overrides.clear()
        client = TestClient(app)
        resp = client.post(
            "/api/v1/voice-preview/generate",
            json={
                "provider": "deepgram",
                "config": {"model": "aura-asteria-en"},
                "text": "Hello",
            },
        )
        assert resp.status_code == 403
        assert resp.json()["detail"] == "Not authenticated"
        # Restore override for remaining tests
        app.dependency_overrides[verify_token] = _mock_verify_token
