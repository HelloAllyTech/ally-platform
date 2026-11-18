"""/builder/step, /step/stream and /extract: dark until enabled, the stream's order,
errors as codes, and tracing off."""

import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.core.builder import catalogue
from app.core.config import settings
from app.main import app
from tests.core.builder.fakes import TASKS, FakeLLM, request

URL = "/api/v1/builder"


@pytest.fixture
def client():
    test_client = TestClient(app)
    test_client.headers.update({"x-api-key": settings.API.X_API_KEY})
    return test_client


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings.BUILDER, "ENABLED", True)


def events(response):
    out = []
    for block in response.text.split("\n\n"):
        lines = [line for line in block.splitlines() if not line.startswith(":")]
        if lines:
            out.append(
                (
                    lines[0].removeprefix("event: "),
                    json.loads(lines[1].removeprefix("data: ")),
                )
            )
    return out


def test_dark_until_enabled(client, monkeypatch):
    monkeypatch.setattr(settings.BUILDER, "ENABLED", False)
    for path in ("/step", "/step/stream", "/extract"):
        assert client.post(f"{URL}{path}", json={}).status_code == 404


@pytest.mark.usefixtures("enabled")
class TestStep:
    def test_step_returns_the_proposal(self, client):
        fake = FakeLLM(ConverseOut=[{"message": "Still reading."}])
        with patch(f"{TASKS}.generate_structured", fake):
            res = client.post(f"{URL}/step", json=request("reading"))
        assert res.status_code == 200
        assert res.json()["message"] == "Still reading."
        assert res.json()["next_step"] == "reading"

    def test_stream_order_and_tokens_spell_the_message(self, client):
        fake = FakeLLM(
            ClassifyOut=[{"industry": "mental_health"}],
            GapsOut=[{"missing": ["fees"]}],
        )
        with patch(f"{TASKS}.generate_structured", fake):
            res = client.post(
                f"{URL}/step/stream",
                json=request("learned", chip=catalogue.LOOKS_RIGHT),
            )
        evts = events(res)
        names = [name for name, _ in evts]
        codes = [d["code"] for n, d in evts if n == "status"]
        assert codes == ["classifying", "finding_gaps", "writing"]
        assert names[-1] == "final"
        first_token = names.index("token")
        assert all(n == "token" for n in names[first_token:-1])
        final = evts[-1][1]
        assert "".join(d["text"] for n, d in evts if n == "token") == final["message"]
        assert final["industry"] == "mental_health"

    def test_a_failed_model_call_is_an_error_code(self, client):
        from app.exceptions.custom_exceptions import LLMInvocationFailedException

        async def boom(**_):
            raise LLMInvocationFailedException("provider said: <owner's words>")

        with patch(f"{TASKS}.generate_structured", boom):
            res = client.post(f"{URL}/step/stream", json=request("reading"))
        assert events(res)[-1] == ("error", {"code": "upstream"})
        assert "owner" not in res.text

    def test_tracing_is_off(self, client):
        fake = FakeLLM(ConverseOut=[{"message": "Hi."}])
        with (
            patch(f"{TASKS}.generate_structured", fake),
            patch("app.core.builder.runner.tracing_context") as tracing,
        ):
            client.post(f"{URL}/step", json=request("reading"))
        tracing.assert_called_once_with(enabled=False)

    def test_extract(self, client):
        fake = FakeLLM(
            ExtractOut=[
                {"facts": [{"section": "hours", "text": "Open 9 to 5.", "page": 1}]}
            ]
        )
        body = {
            "pages": [{"url": "https://a.example/", "title": "Home", "text": "9 to 5"}]
        }
        with patch(f"{TASKS}.generate_structured", fake):
            res = client.post(f"{URL}/extract", json=body)
        assert res.status_code == 200
        assert res.json()["facts"][0]["source_url"] == "https://a.example/"
