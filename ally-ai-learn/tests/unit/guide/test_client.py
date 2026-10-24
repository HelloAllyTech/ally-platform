"""The ally-be client: sessions, NDJSON turn streaming, cancellation."""

import asyncio
from contextlib import aclosing

import pytest

from app.core.guide.client import GuideBackendError, GuideSessionEnded
from app.core.guide.contract import (
    GuideVoiceFrameDelta,
    GuideVoiceFrameDone,
    GuideVoiceTurnRequest,
)
from tests.unit.guide.fakes import ChunkedStream, Recorder, make_client, ndjson


def _request(**overrides) -> GuideVoiceTurnRequest:
    fields = dict(token="vt-secret", client_turn_id="gv-1", text="Can we go on?")
    fields.update(overrides)
    return GuideVoiceTurnRequest(**fields)


async def test_get_session_reads_the_session_and_sends_the_service_key():
    recorder = Recorder(
        (
            200,
            {
                "threadId": "th-1",
                "roomName": "guide-abc",
                "language": "hi",
                "turnMode": "push_to_talk",
            },
        )
    )
    client = make_client(recorder)

    info = await client.get_session("tok/en+=")

    assert (info.thread_id, info.room_name, info.language, info.turn_mode) == (
        "th-1",
        "guide-abc",
        "hi",
        "push_to_talk",
    )
    request = recorder.requests[0]
    assert request.method == "GET"
    assert request.url.raw_path == b"/api/v1/guide/voice/session"
    # The token travels in a header, never the path (paths reach access logs).
    assert request.headers["x-guide-voice-session"] == "tok/en+="
    assert request.headers["x-api-key"] == "svc-key"


async def test_get_session_401_means_the_session_is_over():
    client = make_client(Recorder((401, {"message": "expired"})))
    with pytest.raises(GuideSessionEnded):
        await client.get_session("vt")


async def test_get_session_other_failures_are_backend_errors():
    client = make_client(Recorder((503, b"down")))
    with pytest.raises(GuideBackendError) as excinfo:
        await client.get_session("vt")
    assert excinfo.value.status == 503


async def test_stream_turn_posts_the_contract_body_and_yields_frames():
    body = ndjson(
        {"type": "delta", "text": "Let's "},
        {"type": "delta", "text": "begin."},
        {"type": "done", "turnId": "t1", "messageId": "m1"},
    )
    # Split mid-line to prove the client reassembles across chunks.
    stream = ChunkedStream([body[:20], body[20:45], body[45:]])
    recorder = Recorder((200, stream))
    client = make_client(recorder)

    frames = [
        f
        async for f in client.stream_turn(
            _request(interrupted_turn_id="t0", spoken_chars=12, language="en"),
            traceparent="00-" + "a" * 32 + "-" + "b" * 16 + "-01",
        )
    ]

    assert [type(f) for f in frames] == [
        GuideVoiceFrameDelta,
        GuideVoiceFrameDelta,
        GuideVoiceFrameDone,
    ]
    sent = recorder.json_body()
    assert sent == {
        "token": "vt-secret",
        "clientTurnId": "gv-1",
        "text": "Can we go on?",
        "language": "en",
        "interruptedTurnId": "t0",
        "spokenChars": 12,
    }
    request = recorder.requests[0]
    assert request.url.path == "/api/v1/guide/voice/turns"
    assert request.headers["traceparent"].startswith("00-aaaa")
    assert stream.closed.is_set()


async def test_stream_turn_omits_absent_optional_fields():
    recorder = Recorder((200, ChunkedStream([ndjson({"type": "delta", "text": "x"})])))
    client = make_client(recorder)
    [f async for f in client.stream_turn(_request())]
    assert recorder.json_body() == {
        "token": "vt-secret",
        "clientTurnId": "gv-1",
        "text": "Can we go on?",
    }


async def test_closing_the_turn_stream_early_closes_the_connection():
    # The barge-in: ally-be is still streaming; the worker stops listening.
    stream = ChunkedStream([ndjson({"type": "delta", "text": "Well, "})], hang=True)
    client = make_client(Recorder((200, stream)))

    async with aclosing(client.stream_turn(_request())) as frames:
        first = await frames.__anext__()
        assert first.text == "Well, "

    await asyncio.wait_for(stream.closed.wait(), 1)


async def test_cancelling_the_reader_closes_the_connection():
    stream = ChunkedStream([ndjson({"type": "delta", "text": "Well, "})], hang=True)
    client = make_client(Recorder((200, stream)))
    got_first = asyncio.Event()

    async def read():
        async for _ in client.stream_turn(_request()):
            got_first.set()

    task = asyncio.create_task(read())
    await asyncio.wait_for(got_first.wait(), 1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task

    await asyncio.wait_for(stream.closed.wait(), 1)


async def test_stream_turn_401_raises_session_ended():
    client = make_client(Recorder((401, {"message": "Voice session expired"})))
    with pytest.raises(GuideSessionEnded):
        [f async for f in client.stream_turn(_request())]


async def test_stream_turn_maps_http_refusal_codes():
    client = make_client(
        Recorder((403, {"statusCode": 403, "errorCode": "GUIDE_DISABLED"}))
    )
    with pytest.raises(GuideBackendError) as excinfo:
        [f async for f in client.stream_turn(_request())]
    assert excinfo.value.code == "guide_disabled"


async def test_stream_turn_transport_failure_is_a_backend_error():
    import httpx

    def boom(request):
        raise httpx.ConnectError("refused", request=request)

    from app.core.guide.client import GuideBackendClient

    client = GuideBackendClient(
        "https://be.test", "k", transport=httpx.MockTransport(boom)
    )
    with pytest.raises(GuideBackendError) as excinfo:
        [f async for f in client.stream_turn(_request())]
    assert excinfo.value.code == "transport"


async def test_end_session_posts_and_never_raises():
    recorder = Recorder((500, b"oops"))
    client = make_client(recorder)

    await client.end_session("vt")

    assert recorder.requests[0].method == "POST"
    assert recorder.requests[0].url.path == "/api/v1/guide/voice/session/ended"
    assert recorder.requests[0].headers["x-guide-voice-session"] == "vt"
