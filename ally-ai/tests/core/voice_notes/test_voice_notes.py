"""WA-A §1: a WhatsApp voice note becomes a transcript.

The audio never reaches a language model; only a speech provider hears it.
"""

import base64
from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.api.v1.endpoints import voice_notes as endpoint
from app.core.voice_notes import service

AUDIO = b"OggS-fake-voice-note"


def _keys(sarvam="sk-real", openai="sk-real"):
    return patch.multiple(service.settings.SARVAM, API_KEY=sarvam), patch.multiple(
        service.settings.OPENAI, API_KEY=openai
    )


@pytest.mark.asyncio
async def test_hindi_voice_note_is_transcribed_by_sarvam_with_its_language():
    sarvam_keys, openai_keys = _keys()
    with (
        sarvam_keys,
        openai_keys,
        patch.object(service, "probe_duration", AsyncMock(return_value=8.2)),
        patch.object(service, "wav_pieces", AsyncMock(return_value=[b"wav"])),
        patch.object(
            service,
            "sarvam_transcribe",
            AsyncMock(return_value=("मुझे कल का अपॉइंटमेंट चाहिए", "hi")),
        ) as sarvam,
    ):
        result = await service.transcribe_voice_note(AUDIO, "audio/ogg; codecs=opus")
    assert result.status == "ok"
    assert result.transcript == "मुझे कल का अपॉइंटमेंट चाहिए"
    assert result.language == "hi"
    assert result.provider == "sarvam"
    assert result.duration_sec == 8.2
    sarvam.assert_awaited_once()


@pytest.mark.asyncio
async def test_over_two_minutes_is_not_transcribed():
    sarvam_keys, openai_keys = _keys()
    with (
        sarvam_keys,
        openai_keys,
        patch.object(service, "probe_duration", AsyncMock(return_value=121.0)),
        patch.object(service, "sarvam_transcribe", AsyncMock()) as sarvam,
    ):
        result = await service.transcribe_voice_note(AUDIO, "audio/ogg")
    assert result.status == "too_long"
    sarvam.assert_not_awaited()


@pytest.mark.asyncio
async def test_falls_back_to_whisper_when_sarvam_fails():
    sarvam_keys, openai_keys = _keys()
    with (
        sarvam_keys,
        openai_keys,
        patch.object(service, "probe_duration", AsyncMock(return_value=5.0)),
        patch.object(service, "wav_pieces", AsyncMock(return_value=[b"wav"])),
        patch.object(
            service, "sarvam_transcribe", AsyncMock(side_effect=RuntimeError("503"))
        ),
        patch.object(
            service,
            "_openai_transcribe_sync",
            return_value=("I want to book an appointment for tomorrow", "en"),
        ),
    ):
        result = await service.transcribe_voice_note(AUDIO, "audio/ogg")
    assert result.status == "ok"
    assert result.provider == "openai"
    assert result.language == "en"


@pytest.mark.asyncio
async def test_every_provider_failing_is_reported_never_raised():
    sarvam_keys, openai_keys = _keys()
    with (
        sarvam_keys,
        openai_keys,
        patch.object(service, "probe_duration", AsyncMock(return_value=5.0)),
        patch.object(
            service, "wav_pieces", AsyncMock(side_effect=RuntimeError("ffmpeg"))
        ),
        patch.object(
            service, "_openai_transcribe_sync", side_effect=RuntimeError("down")
        ),
    ):
        result = await service.transcribe_voice_note(AUDIO, "audio/ogg")
    assert result.status == "failed"
    assert result.transcript == ""


@pytest.mark.asyncio
async def test_empty_or_oversized_audio_fails_at_once():
    assert (await service.transcribe_voice_note(b"", "audio/ogg")).status == "failed"
    big = b"0" * (service.MAX_BYTES + 1)
    assert (await service.transcribe_voice_note(big, "audio/ogg")).status == "failed"


@pytest.mark.asyncio
async def test_sarvam_pieces_are_joined_and_the_most_heard_language_wins():
    responses = [
        {"transcript": "kal subah", "language_code": "hi-IN"},
        {"transcript": "appointment chahiye", "language_code": "hi-IN"},
        {"transcript": "please", "language_code": "en-IN"},
    ]

    class FakeResponse:
        def __init__(self, body):
            self._body = body

        def raise_for_status(self):
            return None

        def json(self):
            return self._body

    post = AsyncMock(side_effect=[FakeResponse(b) for b in responses])
    with patch("httpx.AsyncClient.post", post):
        text, language = await service.sarvam_transcribe([b"a", b"b", b"c"])
    assert text == "kal subah appointment chahiye please"
    assert language == "hi"
    assert post.await_args.kwargs["data"]["language_code"] == "unknown"


def test_route_returns_the_transcript():
    app = FastAPI()
    app.include_router(endpoint.router, prefix="/voice-notes")
    client = TestClient(app)
    with patch.object(
        endpoint,
        "transcribe_voice_note",
        AsyncMock(
            return_value=service.VoiceNoteResult(
                status="ok", transcript="hello", language="en", duration_sec=2.0
            )
        ),
    ):
        response = client.post(
            "/voice-notes/transcribe",
            json={
                "audio_base64": base64.b64encode(AUDIO).decode(),
                "mime_type": "audio/ogg",
            },
        )
    assert response.status_code == 200
    assert response.json()["transcript"] == "hello"
    bad = client.post("/voice-notes/transcribe", json={"audio_base64": "!!!"})
    assert bad.status_code == 400
