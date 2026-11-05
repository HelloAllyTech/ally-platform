"""Checkpoints: every run is stored under its conversation and can be read back."""

import os
import uuid
from unittest.mock import patch

import pytest

from app.core.agent_runtime import checkpointer as checkpointer_module
from app.core.agent_runtime.graph import build_graph, get_run_state, run_agent
from app.core.config import settings
from app.core.knowledge_agent.schemas import AnswerIntent, KnowledgeAnswer
from tests.core.agent_runtime.conftest import AGENT, make_bot
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage, stub_generate

pytestmark = pytest.mark.asyncio


async def _two_runs(graph, chunk_service, conversation_id):
    """Run 1 answers; run 2, in the same conversation, declines at the gate."""
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    gen = stub_generate(
        KnowledgeAnswer(intent=AnswerIntent.ANSWER, answer="A.", citations=[1])
    )
    with patch(f"{AGENT}.generate_structured", gen):
        first = await run_agent(
            graph,
            run_id="run-1",
            conversation_id=conversation_id,
            chatbot_id="bot-1",
            question="q1",
            history=[],
            bot=make_bot(),
        )
    chunk_service.search.return_value = []
    second = await run_agent(
        graph,
        run_id="run-2",
        conversation_id=conversation_id,
        chatbot_id="bot-1",
        question="q2",
        history=[],
        bot=make_bot(),
    )
    return first, second


async def test_two_runs_in_one_conversation_are_both_stored(graph, chunk_service):
    first, second = await _two_runs(graph, chunk_service, "conv-1")

    config = {"configurable": {"thread_id": "conv-1"}}
    run_ids = {s.values.get("run_id") async for s in graph.aget_state_history(config)}
    assert {"run-1", "run-2"} <= run_ids

    stored_second = await get_run_state("conv-1", "run-2", graph=graph)
    stored_first = await get_run_state("conv-1", "run-1", graph=graph)
    assert stored_second["result"]["intent"] == "decline"
    assert stored_first["result"]["intent"] == "answer"
    assert await get_run_state("conv-1", "no-such-run", graph=graph) is None


async def test_each_run_starts_clean(graph, chunk_service):
    """Nothing from run 1 (trace, passages, answer) leaks into run 2's state."""
    first, second = await _two_runs(graph, chunk_service, "conv-1")
    assert len(first["trace"]) == 7
    assert len(second["trace"]) == 4
    assert second["passages"] is None
    assert second["answer_raw"] is None


async def test_conversations_are_separate_threads(graph, chunk_service):
    await _two_runs(graph, chunk_service, "conv-a")
    assert await get_run_state("conv-b", "run-1", graph=graph) is None


async def test_without_a_url_checkpoints_are_in_memory(monkeypatch):
    monkeypatch.setattr(settings.AGENT_RUNTIME, "CHECKPOINT_DB_URL", None)
    monkeypatch.setattr(checkpointer_module, "_saver", None)
    with patch.object(checkpointer_module.logger, "warning") as warning:
        saver = await checkpointer_module.open_checkpointer()
    assert type(saver).__name__ == "InMemorySaver"
    warning.assert_called_once()
    await checkpointer_module.close_checkpointer()


@pytest.mark.skipif(
    not os.getenv("AGENT_RUNTIME_TEST_DB_URL"),
    reason="set AGENT_RUNTIME_TEST_DB_URL to run against a real Postgres",
)
async def test_postgres_checkpoints_land_in_their_own_schema(
    service, chunk_service, monkeypatch
):
    schema = f"agent_runtime_test_{uuid.uuid4().hex[:8]}"
    url = os.environ["AGENT_RUNTIME_TEST_DB_URL"]
    monkeypatch.setattr(settings.AGENT_RUNTIME, "CHECKPOINT_DB_URL", url)
    monkeypatch.setattr(settings.AGENT_RUNTIME, "CHECKPOINT_SCHEMA", schema)
    monkeypatch.setattr(checkpointer_module, "_saver", None)
    saver = await checkpointer_module.open_checkpointer()
    try:
        graph = build_graph(service, saver)
        await _two_runs(graph, chunk_service, "conv-pg")
        stored = await get_run_state("conv-pg", "run-2", graph=graph)
        assert stored["result"]["intent"] == "decline"

        from psycopg import AsyncConnection

        async with await AsyncConnection.connect(url) as conn:
            cur = await conn.execute(
                f'SELECT count(*) FROM "{schema}".checkpoints WHERE thread_id = %s',
                ("conv-pg",),
            )
            assert (await cur.fetchone())[0] >= 2
            cur = await conn.execute(
                "SELECT count(*) FROM information_schema.tables "
                "WHERE table_schema = 'public' AND table_name = 'checkpoints'"
            )
            assert (await cur.fetchone())[0] == 0
    finally:
        await checkpointer_module.close_checkpointer()
        from psycopg import AsyncConnection

        async with await AsyncConnection.connect(url, autocommit=True) as conn:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')
