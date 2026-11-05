"""POST /api/v1/agent/run with the conversational agent on."""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.agent_runtime import get_graph
from app.core.config import settings
from app.main import app
from tests.core.agent_runtime.test_agent_graph import (
    CONVERSATION,
    FakeLLM,
    chat,
    reply,
    search,
)
from tests.core.agent_runtime.test_endpoint import BODY, URL
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

AGENT_BODY = {
    **BODY,
    "features": {"agent": True},
    "knowledge_topics": ["Ally FAQ – About Ally", "  ", "x" * 300],
    "decline_text": "A colleague or supervisor is the better route.",
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


@pytest.mark.usefixtures("enabled")
class TestAgentRun:
    def test_smalltalk_comes_back_as_an_uncited_answer_with_turn_type(
        self, client, chunk_service
    ):
        llm = FakeLLM(chat("Hi there!"))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            response = client.post(URL, json={**AGENT_BODY, "question": "hi"})

        assert response.status_code == 200
        data = response.json()
        assert data["intent"] == "answer"
        assert data["decline_reason"] == "none"
        assert data["citations"] == []
        assert data["turn_type"] == "smalltalk"
        assert data["retrieval"]["hit_chunk_ids"] == []
        assert [s["node"] for s in data["trace"]] == ["agent", "check", "finalize"]
        chunk_service.search.assert_not_called()

    def test_topics_are_trimmed_and_reach_the_prompt(self, client, chunk_service):
        llm = FakeLLM(chat("I'm a helper.", turn_type="about_bot"))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            client.post(URL, json={**AGENT_BODY, "question": "who are you?"})
        prompt = llm.calls[0]["prompt"]
        assert "- Ally FAQ – About Ally" in prompt
        assert "- " + "x" * 200 + "\n" in prompt  # capped at 200 characters
        assert "x" * 201 not in prompt
        assert "\n-   \n" not in prompt  # blank titles dropped

    def test_cited_answer(self, client, chunk_service):
        chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
        llm = FakeLLM(search("What is Ally?"), reply(citations=[1]))
        with patch(f"{CONVERSATION}.generate_structured", llm):
            data = client.post(URL, json=AGENT_BODY).json()
        assert data["turn_type"] == "question"
        assert data["citations"][0]["chunk_id"] == CHUNK_A
        assert data["retrieval"]["hit_chunk_ids"] == [CHUNK_A]

    def test_too_many_topics_is_422(self, client):
        body = {**AGENT_BODY, "knowledge_topics": ["t"] * 51}
        assert client.post(URL, json=body).status_code == 422
