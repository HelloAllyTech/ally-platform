"""Q4: a found chunk takes its short neighbours on the same page."""

from unittest.mock import AsyncMock

import pytest

from app.core.config import settings
from app.core.knowledge_base.knowledge_chunk_service import KnowledgeChunkService
from tests.core.knowledge_base.test_knowledge_chunk_service import ANY_AUDIENCE

DOC = "doc-1"


def chunk(index, text):
    return {"id": f"c{index}", "document_id": DOC, "chunk_index": index, "text": text}


PAGE = {
    71: "Botox injection / blepharoplasty",
    72: "Uvea services manage inflammation. " * 10,
    73: "Dr Priti Udhay",
    74: "Head - Oculoplasty & Aesthetic Services. "
    + "Uveitis causes inflammation. " * 8,
    75: "Long text about cataract surgery. " * 10,
}


@pytest.fixture
def service(monkeypatch):
    monkeypatch.setattr(settings.KNOWLEDGE_AGENT, "HYBRID_SEARCH", False)
    monkeypatch.setattr(settings.KNOWLEDGE_AGENT, "NEIGHBOUR_CHUNKS", True)
    db = AsyncMock()

    async def chunks_at(collection_name, wanted):
        return [chunk(i, PAGE[i]) for i in wanted.get(DOC, []) if i in PAGE]

    db.chunks_at.side_effect = chunks_at
    embedding = AsyncMock()
    embedding.embed.return_value = [0.1]
    return KnowledgeChunkService(vector_db=db, embedding_service=embedding), db


@pytest.mark.asyncio
async def test_a_long_chunk_takes_the_short_name_before_it(service):
    svc, db = service
    db.near_vector_search.return_value = [{**chunk(74, PAGE[74]), "similarity": 0.6}]
    [p] = await svc.search("Who heads oculoplasty?", ANY_AUDIENCE)
    assert p["text"].startswith("Dr Priti Udhay\nHead - Oculoplasty")
    # The long chunks either side don't join a long chunk.
    assert "cataract" not in p["text"] and "Uvea services" not in p["text"]
    assert p["chunk_id"] == "c74"


@pytest.mark.asyncio
async def test_a_short_chunk_takes_its_neighbours_either_side(service):
    svc, db = service
    db.near_vector_search.return_value = [{**chunk(73, PAGE[73]), "similarity": 0.6}]
    [p] = await svc.search("Priti Udhay", ANY_AUDIENCE)
    assert "Uvea services" in p["text"] and "Head - Oculoplasty" in p["text"]
    assert len(p["text"]) <= 1500


@pytest.mark.asyncio
async def test_off_or_failing_leaves_the_passages_as_found(service, monkeypatch):
    svc, db = service
    db.near_vector_search.return_value = [{**chunk(74, PAGE[74]), "similarity": 0.6}]
    db.chunks_at.side_effect = RuntimeError("weaviate down")
    [p] = await svc.search("Who heads oculoplasty?", ANY_AUDIENCE)
    assert p["text"] == PAGE[74]
    monkeypatch.setattr(settings.KNOWLEDGE_AGENT, "NEIGHBOUR_CHUNKS", False)
    db.chunks_at.reset_mock()
    await svc.search("Who heads oculoplasty?", ANY_AUDIENCE)
    db.chunks_at.assert_not_called()
