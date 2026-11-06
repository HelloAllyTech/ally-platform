"""Golden parity: the same mocked inputs through both endpoints give the same reply.

This is the one place exact citation ORDER is asserted. Live parity runs compare
the set of cited chunks only, because the model's own ordering is not stable.
"""

from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from app.api.v1.endpoints.agent_runtime import get_graph
from app.core.config import settings
from app.core.dependencies import get_knowledge_agent_service
from app.core.knowledge_agent.schemas import AnswerIntent, KnowledgeAnswer
from app.main import app
from tests.core.agent_runtime.conftest import AGENT
from tests.core.knowledge_agent.test_agent import (
    CHUNK_A,
    CHUNK_B,
    passage,
    stub_generate,
)

REQUEST = {
    "question": "How should I ask about risk?",
    "audience": {"unrestricted": True},
    "translate_query": False,
    "history": [{"role": "user", "content": "hi"}],
    "persona": {"display_name": "Ally", "tone": "warm"},
}

CASES = [
    pytest.param(
        [passage(CHUNK_A, 0.81), passage(CHUNK_B, 0.78)],
        KnowledgeAnswer(
            intent=AnswerIntent.ANSWER,
            answer="Ask directly.",
            citations=[2, 1],
            language="en",
            confidence=0.8,
        ),
        id="answer-with-ordered-citations",
    ),
    pytest.param([passage(CHUNK_A, 0.30)], None, id="gate-decline"),
    pytest.param(
        [passage(CHUNK_A, 0.70)],
        KnowledgeAnswer(intent=AnswerIntent.CLARIFY, answer="About which client?"),
        id="clarify",
    ),
]


@pytest.fixture
def client(service, graph, monkeypatch):
    monkeypatch.setattr(settings.AGENT_RUNTIME, "ENABLED", True)
    app.dependency_overrides[get_graph] = lambda: graph
    app.dependency_overrides[get_knowledge_agent_service] = lambda: service
    test_client = TestClient(app)
    test_client.headers.update({"x-api-key": settings.API.X_API_KEY})
    yield test_client
    app.dependency_overrides.pop(get_graph, None)
    app.dependency_overrides.pop(get_knowledge_agent_service, None)


@pytest.mark.parametrize("hits, answer", CASES)
def test_both_endpoints_give_the_same_reply(client, chunk_service, hits, answer):
    chunk_service.search.return_value = hits

    def post(url, body):
        gen = stub_generate(answer) if answer else stub_generate()
        with patch(f"{AGENT}.generate_structured", gen):
            response = client.post(url, json=body)
        assert response.status_code == 200
        return response.json(), gen

    old, old_gen = post("/api/v1/knowledge-agent/answer", REQUEST)
    new, new_gen = post("/api/v1/agent/run", {**REQUEST, "conversation_id": "g-1"})

    assert new["intent"] == old["intent"]
    assert new["answer"] == old["answer"]
    assert new["citations"] == old["citations"]  # ordered, field for field
    assert new["decline_reason"] == old["decline_reason"]
    new_retrieval = {k: v for k, v in new["retrieval"].items() if k != "hit_chunk_ids"}
    assert new_retrieval == old["retrieval"]
    for key in ("language", "confidence", "provider", "model", "prompt_version"):
        assert new[key] == old[key]
    # The same prompt went to the model, so the persona and history reached it too.
    assert new_gen.await_args_list == old_gen.await_args_list
