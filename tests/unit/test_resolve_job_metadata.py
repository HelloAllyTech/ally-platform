"""Tests for resolve_job_metadata (slim metadataFetch dispatch envelopes).

The slim-dispatch contract: ally-be sends
``{version, metadataFetch: {roomName, url}, scenarioSession?}`` instead of the
full room-metadata envelope; the worker resolves the pointer via the
x-api-key-guarded webhook and overlays slim ``scenarioSession`` fields onto
the fetched payload. Inline (legacy) payloads pass through byte-for-byte.
"""

import json

import pytest

from app.core.agent.factory import resolve_job_metadata


class _FakeResp:
    def __init__(self, payload, status=200):
        self._payload = payload
        self.status_code = status

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"http {self.status_code}")

    def json(self):
        return self._payload


class _FakeClient:
    """Async context-manager client that fails the first N gets, then succeeds.

    Class-level state mirrors the _FlakyClient helper in
    tests/roleplay_v2/test_runtime_improvements.py.
    """

    fail_count = 0
    payload = None
    calls: list = []

    def __init__(self, *args, **kwargs):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def get(self, url, headers=None):
        _FakeClient.calls.append({"url": url, "headers": headers})
        if _FakeClient.fail_count > 0:
            _FakeClient.fail_count -= 1
            raise RuntimeError("transient")
        return _FakeResp(_FakeClient.payload)


async def _noop_sleep(*_args, **_kwargs):
    return None


@pytest.fixture(autouse=True)
def _reset_fake_client(monkeypatch):
    import httpx

    _FakeClient.fail_count = 0
    _FakeClient.payload = None
    _FakeClient.calls = []
    monkeypatch.setattr(httpx, "AsyncClient", _FakeClient)
    monkeypatch.setattr("asyncio.sleep", _noop_sleep)


FULL_ENVELOPE = {
    "version": "1.0",
    "tenantId": "t1",
    "environment": "test",
    "scenario": {"title": "Kavya", "prompt": "x" * 100},
}

SLIM = {
    "version": "1.0",
    "metadataFetch": {
        "roomName": "ss_abc",
        "url": "https://api.example/v1/learn/webhook/room-metadata/ss_abc",
    },
}


class TestInlinePassthrough:
    """Anything without a metadataFetch key passes through unchanged."""

    async def test_full_inline_envelope_is_untouched(self):
        raw = json.dumps(FULL_ENVELOPE)
        assert await resolve_job_metadata(raw) == raw
        assert _FakeClient.calls == []

    async def test_invalid_json_passes_through(self):
        # parse_room_metadata owns error handling for invalid payloads.
        assert await resolve_job_metadata("not-json{") == "not-json{"

    async def test_none_and_empty_pass_through(self):
        assert await resolve_job_metadata(None) is None
        assert await resolve_job_metadata("") == ""

    async def test_non_dict_json_passes_through(self):
        assert await resolve_job_metadata("[1, 2]") == "[1, 2]"


class TestFetch:
    async def test_fetches_full_envelope(self):
        _FakeClient.payload = dict(FULL_ENVELOPE)

        resolved = await resolve_job_metadata(json.dumps(SLIM))

        assert json.loads(resolved) == FULL_ENVELOPE
        assert len(_FakeClient.calls) == 1
        assert _FakeClient.calls[0]["url"] == SLIM["metadataFetch"]["url"]

    async def test_sends_core_service_api_key(self):
        from app.core.config import settings

        _FakeClient.payload = dict(FULL_ENVELOPE)
        await resolve_job_metadata(json.dumps(SLIM))

        headers = _FakeClient.calls[0]["headers"]
        assert headers == {"x-api-key": settings.CORE_SERVICE_API_KEY}

    async def test_overlays_slim_scenario_session(self):
        # The participant_joined handler injects conversationStartedAt into
        # the (slim) dispatch metadata; it must win over any stored value.
        _FakeClient.payload = {
            **FULL_ENVELOPE,
            "scenarioSession": {"conversationStartedAt": "stale", "other": 1},
        }
        slim = {
            **SLIM,
            "scenarioSession": {"conversationStartedAt": "2026-07-23T05:00:00Z"},
        }

        resolved = json.loads(await resolve_job_metadata(json.dumps(slim)))

        assert resolved["scenarioSession"] == {
            "conversationStartedAt": "2026-07-23T05:00:00Z",
            "other": 1,
        }

    async def test_retries_then_succeeds(self):
        _FakeClient.fail_count = 2
        _FakeClient.payload = dict(FULL_ENVELOPE)

        resolved = await resolve_job_metadata(json.dumps(SLIM))

        assert json.loads(resolved) == FULL_ENVELOPE
        assert len(_FakeClient.calls) == 3

    async def test_raises_after_exhausting_attempts(self):
        _FakeClient.fail_count = 99

        with pytest.raises(RuntimeError, match="room metadata fetch failed"):
            await resolve_job_metadata(json.dumps(SLIM))

    async def test_pointer_without_url_raises(self):
        slim = {"version": "1.0", "metadataFetch": {"roomName": "ss_abc"}}

        with pytest.raises(ValueError, match="no url"):
            await resolve_job_metadata(json.dumps(slim))

    async def test_non_object_fetch_response_raises(self):
        _FakeClient.payload = [1, 2, 3]

        with pytest.raises(ValueError, match="expected object"):
            await resolve_job_metadata(json.dumps(SLIM))
