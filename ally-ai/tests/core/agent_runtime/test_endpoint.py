"""Tests for POST /api/v1/agent/run.

The contract: a superset of /knowledge-agent/answer (same request fields plus
conversation_id; same response fields plus run_id, trace and runtime), the same
status codes, and a 404 for everything while the runtime is switched off.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.agent_runtime import get_graph
from app.core.config import settings
from app.core.knowledge_agent.schemas import AnswerIntent, KnowledgeAnswer
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    LLMInvocationFailedException,
    VectorDBSearchFailedException,
)
from app.main import app
from app.schemas.knowledge_agent import KnowledgeAnswerResponse
from tests.core.agent_runtime.conftest import AGENT
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage, stub_generate

URL = "/api/v1/agent/run"
BODY = {
    "question": "What is Ally?",
    "conversation_id": "conv-1",
    "audience": {"unrestricted": True},
    "translate_query": False,
}


@pytest.fixture
def enabled(monkeypatch):
    monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", True)


@pytest.fixture
def client(graph):
    app.dependency_overrides[get_graph] = lambda: graph
    test_client = TestClient(app)
    test_client.headers.update({"x-api-key": settings.API.X_API_KEY})
    yield test_client
    app.dependency_overrides.pop(get_graph, None)


class TestFlag:
    def test_off_is_404(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", False)
        assert client.post(URL, json=BODY).status_code == 404

    def test_off_is_404_even_for_an_invalid_body(self, client, monkeypatch):
        """Not 422: while off, the route should not appear to exist at all."""
        monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", False)
        assert client.post(URL, json={}).status_code == 404

    def test_off_by_default(self):
        assert type(settings.AGENT_RUNTIME)().ENABLED is False


@pytest.mark.usefixtures("enabled")
class TestRun:
    def test_answer_returns_the_old_fields_plus_run_fields(self, client, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = stub_generate(
            KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.", citations=[1])
        )
        with patch(f"{AGENT}.generate_structured", gen):
            response = client.post(URL, json=BODY)

        assert response.status_code == 200
        data = response.json()
        old_fields = set(KnowledgeAnswerResponse.model_fields)
        assert old_fields <= set(data)
        assert set(data) - old_fields == {"run_id", "trace", "runtime"}
        assert data["runtime"] == "v2"
        assert data["intent"] == "answer"
        assert data["citations"][0]["chunk_id"] == CHUNK_A
        assert data["retrieval"]["hit_chunk_ids"] == [CHUNK_A]
        assert [s["node"] for s in data["trace"]] == [
            "translate",
            "retrieve",
            "gate",
            "select",
            "write",
            "check",
            "finalize",
        ]

    def test_run_id_is_echoed_or_generated(self, client):
        given = client.post(URL, json={**BODY, "run_id": "run-42"}).json()
        generated = client.post(URL, json={**BODY, "conversation_id": "c2"}).json()
        assert given["run_id"] == "run-42"
        assert len(generated["run_id"]) == 36

    def test_decline_is_200(self, client):
        response = client.post(URL, json=BODY)
        assert response.status_code == 200
        assert response.json()["decline_reason"] == "no_hits"
        assert len(response.json()["trace"]) == 4

    def test_log_retrieval_defaults_to_true_and_can_be_switched_off(
        self, client, chunk_service
    ):
        with patch(f"{AGENT}.emit_retrieval_log") as emit:
            client.post(URL, json=BODY)
            assert emit.call_count == 1
            response = client.post(
                URL, json={**BODY, "conversation_id": "c2", "log_retrieval": False}
            )
            assert emit.call_count == 1
        assert response.status_code == 200
        assert response.json()["decline_reason"] == "no_hits"

    def test_conversation_id_is_required(self, client):
        body = {k: v for k, v in BODY.items() if k != "conversation_id"}
        assert client.post(URL, json=body).status_code == 422

    def test_audience_is_still_required(self, client):
        body = {k: v for k, v in BODY.items() if k != "audience"}
        assert client.post(URL, json=body).status_code == 422

    def test_needs_the_service_api_key(self, client):
        response = client.post(URL, json=BODY, headers={"x-api-key": "wrong"})
        assert response.status_code == 401

    @pytest.mark.parametrize(
        "error, status_code",
        [
            (EmbeddingFailedException("x"), 502),
            (VectorDBSearchFailedException("x"), 503),
            (RuntimeError("x"), 500),
        ],
    )
    def test_retrieval_failures_map_like_the_old_route(
        self, client, chunk_service, error, status_code
    ):
        chunk_service.search.side_effect = error
        assert client.post(URL, json=BODY).status_code == status_code

    def test_llm_failure_is_502_not_a_decline(self, client, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        gen = AsyncMock(side_effect=LLMInvocationFailedException("model down"))
        with patch(f"{AGENT}.generate_structured", gen):
            assert client.post(URL, json=BODY).status_code == 502
