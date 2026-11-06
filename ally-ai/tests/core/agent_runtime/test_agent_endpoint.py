"""POST /api/v1/agent/run: what the conversational agent adds to the response."""

from unittest.mock import patch

import pytest

from tests.core.agent_runtime.conftest import BODY, URL
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, chat, reply, search
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

AGENT_BODY = {
    **BODY,
    "knowledge_topics": ["Ally FAQ – About Ally", "  ", "x" * 300],
    "decline_text": "A colleague or supervisor is the better route.",
}


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
        assert [s["node"] for s in data["trace"]] == ["agent", "check"]
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
