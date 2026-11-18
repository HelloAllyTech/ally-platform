"""
Tests for migration 010: drop the retired AgentMemory collection
"""

import importlib
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.vector_db.constants import VectorDBCollectionNames

migration_010 = importlib.import_module(
    "app.migrations.010-drop-agent-memory-collection"
)


def _client(names):
    client = MagicMock()
    collections = []
    for name in names:
        col = MagicMock()
        col.name = name
        collections.append(col)
    client.collections.list_all = AsyncMock(return_value=collections)
    client.collections.delete = AsyncMock()
    client.collections.create = AsyncMock()
    return client


class TestMigration010:
    @pytest.mark.asyncio
    async def test_up_drops_the_collection_when_present(self):
        client = _client([VectorDBCollectionNames.AGENT_MEMORIES, "KnowledgeChunk"])

        await migration_010.up(client)

        client.collections.delete.assert_called_once_with(
            VectorDBCollectionNames.AGENT_MEMORIES
        )

    @pytest.mark.asyncio
    async def test_up_is_a_no_op_when_already_gone(self):
        client = _client(["KnowledgeChunk"])

        await migration_010.up(client)

        client.collections.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_up_never_touches_another_collection(self):
        client = _client(
            [
                VectorDBCollectionNames.AGENT_MEMORIES,
                VectorDBCollectionNames.KNOWLEDGE_CHUNKS,
                "CtxBugHunterNotes_v1",
            ]
        )

        await migration_010.up(client)

        assert client.collections.delete.await_count == 1

    @pytest.mark.asyncio
    async def test_up_raises_when_the_drop_fails(self):
        client = _client([VectorDBCollectionNames.AGENT_MEMORIES])
        client.collections.delete = AsyncMock(side_effect=Exception("boom"))

        with pytest.raises(Exception, match="boom"):
            await migration_010.up(client)

    @pytest.mark.asyncio
    async def test_down_recreates_it_empty(self):
        client = _client([])

        await migration_010.down(client)

        client.collections.create.assert_called_once()
        assert (
            client.collections.create.call_args.kwargs["name"]
            == VectorDBCollectionNames.AGENT_MEMORIES
        )
