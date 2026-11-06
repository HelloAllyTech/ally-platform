"""Checkpoints: every run is stored under its conversation and can be read back."""

import os
import uuid
from contextlib import contextmanager
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from psycopg import AsyncConnection
from psycopg_pool import AsyncConnectionPool

from app.core.agent_runtime import checkpointer as checkpointer_module
from app.core.agent_runtime.graph import (
    build_graph,
    close_agent_runtime,
    get_agent_graph,
    get_run_state,
    open_agent_runtime,
    run_agent,
)
from app.core.agent_runtime.state import RUN_SCOPED_KEYS, AgentState, RunInput
from app.core.config import settings
from tests.core.agent_runtime.conftest import make_bot
from tests.core.agent_runtime.steps import CONVERSATION, FakeLLM, chat, reply, search
from tests.core.knowledge_agent.test_agent import CHUNK_A, passage

pytestmark = pytest.mark.asyncio


async def _two_runs(graph, chunk_service, conversation_id):
    """Run 1 answers from a search; run 2, in the same conversation, is smalltalk."""
    chunk_service.search.return_value = [passage(CHUNK_A, 0.7)]
    llm = FakeLLM(search("q1"), reply(citations=[1]), chat("Bye!"))
    with patch(f"{CONVERSATION}.generate_structured", llm):
        return [
            await run_agent(
                graph,
                run_id=run_id,
                conversation_id=conversation_id,
                chatbot_id="bot-1",
                question=question,
                history=[],
                bot=make_bot(),
            )
            for run_id, question in (("run-1", "q1"), ("run-2", "bye"))
        ]


async def test_two_runs_in_one_conversation_are_both_stored(graph, chunk_service):
    await _two_runs(graph, chunk_service, "conv-1")

    config = {"configurable": {"thread_id": "conv-1"}}
    run_ids = {s.values.get("run_id") async for s in graph.aget_state_history(config)}
    assert {"run-1", "run-2"} <= run_ids

    stored_second = await get_run_state("conv-1", "run-2", graph=graph)
    stored_first = await get_run_state("conv-1", "run-1", graph=graph)
    assert stored_second["result"]["turn_type"] == "smalltalk"
    assert stored_first["result"]["citations"][0]["chunk_id"] == CHUNK_A
    assert await get_run_state("conv-1", "no-such-run", graph=graph) is None


async def test_each_run_starts_clean(graph, chunk_service):
    """Nothing from run 1 (trace, passages, answer) leaks into run 2's state."""
    first, second = await _two_runs(graph, chunk_service, "conv-1")
    assert len(first["trace"]) == 4
    assert len(second["trace"]) == 2
    assert second["passages"] == []
    assert second["tool_calls"] == []
    assert second["retrieval"] is None


async def test_every_working_key_is_cleared_between_runs():
    """A state key is run input, cleared per run, or the trace: none can leak."""
    inputs = set(RunInput.__annotations__)
    assert set(AgentState.__annotations__) == inputs | set(RUN_SCOPED_KEYS) | {"trace"}
    assert not inputs & set(RUN_SCOPED_KEYS)


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
        assert stored["result"]["turn_type"] == "smalltalk"

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
        async with await AsyncConnection.connect(url, autocommit=True) as conn:
            await conn.execute(f'DROP SCHEMA IF EXISTS "{schema}" CASCADE')


class FakePool:
    """Stands in for psycopg_pool.AsyncConnectionPool; records how it was built."""

    instances: list = []
    check_connection = staticmethod(AsyncConnectionPool.check_connection)

    def __init__(self, *args, **kwargs):
        self.kwargs = kwargs
        self.open = AsyncMock()
        self.close = AsyncMock()
        FakePool.instances.append(self)


def _fake_connection():
    conn = MagicMock()
    conn.__aenter__ = AsyncMock(return_value=conn)
    conn.__aexit__ = AsyncMock(return_value=False)
    conn.execute = AsyncMock()
    return conn


@contextmanager
def _postgres_reachable(saver):
    """Postgres connects, with the pool and saver replaced by fakes."""
    with (
        patch(
            "psycopg.AsyncConnection.connect",
            AsyncMock(return_value=_fake_connection()),
        ),
        patch("psycopg_pool.AsyncConnectionPool", FakePool),
        patch(
            "langgraph.checkpoint.postgres.aio.AsyncPostgresSaver",
            MagicMock(return_value=saver),
        ),
    ):
        yield


@pytest.fixture
def postgres_configured(monkeypatch):
    monkeypatch.setattr(
        settings.AGENT_RUNTIME, "CHECKPOINT_DB_URL", "postgresql://u@db/agent"
    )
    monkeypatch.setattr(checkpointer_module, "_saver", None)
    monkeypatch.setattr(checkpointer_module, "_pool", None)
    monkeypatch.setattr(checkpointer_module, "_unavailable", False)
    FakePool.instances = []


class TestStartupWithoutItsDatabase:
    async def test_an_unreachable_database_leaves_the_runtime_off(
        self, postgres_configured
    ):
        connect = AsyncMock(side_effect=OSError("connection refused"))
        with (
            patch("psycopg.AsyncConnection.connect", connect),
            patch.object(checkpointer_module.logger, "error") as error,
        ):
            saver = await checkpointer_module.open_checkpointer()
        assert saver is None
        assert checkpointer_module.checkpointer_available() is False
        error.assert_called_once()
        assert "connection refused" not in str(error.call_args)
        await checkpointer_module.close_checkpointer()
        assert checkpointer_module.checkpointer_available() is True

    async def test_a_failed_setup_closes_the_pool(self, postgres_configured):
        saver = MagicMock()
        saver.setup = AsyncMock(side_effect=RuntimeError("no permission"))
        with _postgres_reachable(saver):
            assert await checkpointer_module.open_checkpointer() is None
        (pool,) = FakePool.instances
        pool.open.assert_awaited_once()
        pool.close.assert_awaited_once()
        assert checkpointer_module.checkpointer_available() is False
        await checkpointer_module.close_checkpointer()

    async def test_pooled_connections_are_checked_before_use(self, postgres_configured):
        saver = MagicMock()
        saver.setup = AsyncMock()
        with _postgres_reachable(saver):
            assert await checkpointer_module.open_checkpointer() is saver
        (pool,) = FakePool.instances
        assert pool.kwargs["check"] == AsyncConnectionPool.check_connection
        assert checkpointer_module.checkpointer_available() is True
        await checkpointer_module.close_checkpointer()
        pool.close.assert_awaited_once()


class TestTheCachedGraph:
    async def test_the_memory_fallback_is_not_kept(self, monkeypatch):
        monkeypatch.setattr(checkpointer_module, "_saver", None)
        checkpointer_module.get_checkpointer()
        assert checkpointer_module._saver is None

    async def test_startup_and_shutdown_drop_the_compiled_graph(
        self, service, monkeypatch
    ):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "CHECKPOINT_DB_URL", None)
        monkeypatch.setattr(checkpointer_module, "_saver", None)
        before = get_agent_graph(service)
        await open_agent_runtime()
        opened = get_agent_graph(service)
        assert opened is not before
        assert opened.checkpointer is checkpointer_module._saver
        await close_agent_runtime()
        assert get_agent_graph(service) is not opened
        get_agent_graph.cache_clear()
