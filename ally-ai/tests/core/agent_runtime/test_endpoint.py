"""Tests for POST /api/v1/agent/run.

The contract: a superset of /knowledge-agent/answer (same request fields plus
conversation_id; same response fields plus run_id, trace and runtime), the same
status codes, and a 404 for everything while the runtime is switched off.
"""

from unittest.mock import AsyncMock, patch

import pytest

from app.core.agent_runtime import checkpointer as checkpointer_module
from app.core.config import settings
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    LLMInvocationFailedException,
    VectorDBSearchFailedException,
)
from app.schemas.knowledge_agent import KnowledgeAnswerResponse
from tests.core.agent_runtime.conftest import AGENT, BODY, URL
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, chat, reply, search
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage


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
        llm = FakeLLM(search("What is Ally?"), reply(answer="A.", citations=[1]))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(URL, json=BODY)

        assert response.status_code == 200
        data = response.json()
        old_fields = set(KnowledgeAnswerResponse.model_fields)
        assert old_fields <= set(data)
        assert set(data) - old_fields == {"run_id", "trace", "runtime", "turn_type"}
        assert data["runtime"] == "v2"
        assert data["intent"] == "answer"
        assert data["citations"][0]["chunk_id"] == CHUNK_A
        assert data["retrieval"]["hit_chunk_ids"] == [CHUNK_A]
        assert [s["node"] for s in data["trace"]] == ["agent", "tool", "agent", "check"]

    def test_run_id_is_echoed_or_generated(self, client):
        with patch(f"{CONVERSATION}.generate_structured", FakeLLM(chat(), chat())):
            given = client.post(URL, json={**BODY, "run_id": "run-42"}).json()
            generated = client.post(URL, json={**BODY, "conversation_id": "c2"}).json()
        assert given["run_id"] == "run-42"
        assert len(generated["run_id"]) == 36

    def test_decline_is_200(self, client):
        llm = FakeLLM(
            search("What is Ally?"), reply("decline", "Not something I cover.")
        )
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(URL, json=BODY)
        assert response.status_code == 200
        assert response.json()["decline_reason"] == "no_hits"

    def test_log_retrieval_defaults_to_true_and_can_be_switched_off(
        self, client, chunk_service
    ):
        steps = [search("q"), reply("decline", "No.")] * 2
        with (
            patch(f"{AGENT}.emit_retrieval_log") as emit,
            patch(f"{CONVERSATION}.generate_structured", FakeLLM(*steps)),
        ):
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
        with patch(f"{CONVERSATION}.generate_structured", FakeLLM(search("q"))):
            assert client.post(URL, json=BODY).status_code == status_code

    def test_llm_failure_is_502_not_a_decline(self, client, chunk_service):
        gen = AsyncMock(side_effect=LLMInvocationFailedException("model down"))
        with patch(f"{CONVERSATION}.generate_structured", gen):
            assert client.post(URL, json=BODY).status_code == 502

    def test_a_bad_final_state_is_a_mapped_500(self, client, monkeypatch):
        """Building the response is inside the error mapping too."""
        monkeypatch.setattr(
            "app.api.v1.endpoints.agent_runtime.run_agent",
            AsyncMock(return_value={"trace": []}),
        )
        response = client.post(URL, json=BODY)
        assert response.status_code == 500
        assert response.json()["detail"] == "Failed to answer the question"


class TestUnavailable:
    def test_on_but_without_its_database_is_503(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", True)
        monkeypatch.setattr(checkpointer_module, "_unavailable", True)
        response = client.post(URL, json=BODY)
        assert response.status_code == 503
        assert response.json()["detail"] == "The agent runtime is unavailable"

    def test_off_is_still_404_when_its_database_is_down(self, client, monkeypatch):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", False)
        monkeypatch.setattr(checkpointer_module, "_unavailable", True)
        assert client.post(URL, json=BODY).status_code == 404
