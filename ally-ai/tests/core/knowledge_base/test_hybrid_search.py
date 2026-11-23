"""Q4: keyword search beside vector search."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import settings
from app.core.knowledge_base.knowledge_chunk_service import KnowledgeChunkService
from app.core.vector_db.weaviate import WeaviateDB, _cosine
from tests.core.knowledge_base.test_knowledge_chunk_service import ANY_AUDIENCE


def test_cosine():
    assert _cosine([1, 0], [1, 0]) == pytest.approx(1.0)
    assert _cosine([1, 0], [0, 1]) == pytest.approx(0.0)
    assert _cosine([], [1]) == 0.0


def _obj(uuid, vec, score, text):
    return SimpleNamespace(
        uuid=uuid,
        vector={"default": vec},
        metadata=SimpleNamespace(score=score),
        properties={"text": text},
    )


@pytest.mark.asyncio
async def test_a_strong_keyword_match_is_lifted_beside_the_vector_matches():
    db = WeaviateDB.__new__(WeaviateDB)
    db._semaphore = AsyncMock()
    db._semaphore.__aenter__.return_value = None
    db._semaphore.__aexit__.return_value = None
    collection = MagicMock()
    collection.query.hybrid = AsyncMock(
        return_value=SimpleNamespace(
            objects=[
                # The vector's best match, a weak keyword one.
                _obj("a", [1.0, 0.0], 0.55, "about the hospital"),
                # The exact name: a lower cosine, the keyword search's best.
                _obj("b", [0.6, 0.8], 1.0, "Dr Priti Udhay, Head of Oculoplasty"),
                # Neither: under the floor.
                _obj("c", [0.0, 1.0], 0.1, "careers"),
            ]
        )
    )
    db.client = MagicMock()
    db.client.collections.get.return_value = collection

    hits = await db.hybrid_search(
        "KnowledgeChunk", "Who heads oculoplasty?", [1.0, 0.0], min_similarity=0.35
    )

    assert [h["id"] for h in hits] == ["a", "b"]
    assert hits[0]["similarity"] == pytest.approx(1.0)
    # Lifted to its fused score times the best cosine, above its own 0.6.
    assert hits[1]["similarity"] == pytest.approx(1.0)
    assert hits[1]["vector_similarity"] == pytest.approx(0.6)
    kwargs = collection.query.hybrid.call_args.kwargs
    assert kwargs["query"] == "Who heads oculoplasty?" and kwargs["alpha"] == 0.5


@pytest.mark.asyncio
async def test_the_service_uses_hybrid_unless_switched_off(monkeypatch):
    vector_db = AsyncMock()
    vector_db.hybrid_search.return_value = []
    vector_db.near_vector_search.return_value = []
    embedding = AsyncMock()
    embedding.embed.return_value = [0.1]
    service = KnowledgeChunkService(vector_db=vector_db, embedding_service=embedding)

    monkeypatch.setattr(settings.KNOWLEDGE_AGENT, "HYBRID_SEARCH", True)
    await service.search("day pass price", ANY_AUDIENCE)
    assert vector_db.hybrid_search.call_args.kwargs["query"] == "day pass price"
    vector_db.near_vector_search.assert_not_called()

    monkeypatch.setattr(settings.KNOWLEDGE_AGENT, "HYBRID_SEARCH", False)
    await service.search("day pass price", ANY_AUDIENCE)
    vector_db.near_vector_search.assert_called_once()
