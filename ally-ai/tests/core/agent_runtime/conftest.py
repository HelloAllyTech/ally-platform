"""Shared fixtures for the agent runtime tests.

The graph runs the real KnowledgeAgentService over a mocked chunk service, with
`generate_structured` patched — the same seams the knowledge agent's own tests use,
so a behaviour asserted there can be asserted here against the graph.
"""

from unittest.mock import AsyncMock, patch

import pytest
from langgraph.checkpoint.memory import InMemorySaver

from app.core.agent_runtime.graph import build_graph, run_agent
from app.core.knowledge_agent.agent import KnowledgeAgentService

AGENT = "app.core.knowledge_agent.agent"

UNRESTRICTED = {"unrestricted": True, "include_global": True, "tenant_id": None}


def make_bot(**overrides):
    """The `bot` block the endpoint builds from a request, with request defaults."""
    bot = {
        "prompts": None,
        "limits": {},
        "max_answer_chars": 1400,
        "translate_query": False,
        "document_ids": None,
        "persona": None,
        "answer_mode": "documents_only",
        "channel": None,
        "audience": UNRESTRICTED,
    }
    bot.update(overrides)
    return bot


@pytest.fixture
def chunk_service():
    svc = AsyncMock()
    svc.search.return_value = []
    return svc


@pytest.fixture
def service(chunk_service):
    return KnowledgeAgentService(chunk_service)


@pytest.fixture
def graph(service):
    return build_graph(service, InMemorySaver())


@pytest.fixture
def retrieval_log():
    """Every retrieval-log emission, so tests can count them."""
    with patch(f"{AGENT}.emit_retrieval_log") as emit:
        yield emit


@pytest.fixture
def run(graph):
    """Run the graph once: ``await run("question", conversation_id=..., **bot)``."""

    async def _run(question, *, conversation_id="conv-1", run_id="run-1", **bot):
        history = bot.pop("history", [])
        return await run_agent(
            graph,
            run_id=run_id,
            conversation_id=conversation_id,
            chatbot_id="bot-1",
            question=question,
            history=history,
            bot=make_bot(**bot),
        )

    return _run
