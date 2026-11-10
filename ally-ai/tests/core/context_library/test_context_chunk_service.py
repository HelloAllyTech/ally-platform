"""Tests for ContextChunkService and the collection-name boundary.

What is under test is mostly what would fail SILENTLY: a name that reaches a collection
it should not, a per-item failure swallowed into a batch, an audience or scope that
widens into an unfiltered search, a missing collection reported as an outage (or an
outage reported as an empty library), and a rank off by one.
"""

from unittest.mock import AsyncMock

import pytest

from app.core.context_library.collection_schema import (
    DEFAULT_BM25_PROPERTIES,
    InvalidContextCollectionName,
    validate_collection_name,
)
from app.core.context_library.context_chunk_service import (
    ConfirmationMismatch,
    ContextChunkService,
)
from app.core.knowledge_base.knowledge_chunk_service import ChunkAudience
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    VectorDBSearchFailedException,
)

COLLECTION = "CtxFirstPrinciples_v1"
CHUNK_A = "11111111-1111-1111-1111-111111111111"
CHUNK_B = "22222222-2222-2222-2222-222222222222"
TENANT = "33333333-3333-3333-3333-333333333333"
EVERYONE = ChunkAudience.unrestricted()


def make_item(chunk_id=CHUNK_A, statement="Ask one question at a time.", **extra):
    item = {
        "chunk_id": chunk_id,
        "statement_text": statement,
        "situations_text": "When a counsellor stacks questions.",
        "properties": {
            "code": "FP-001",
            "collection_id": "c1",
            "status": "active",
            "statement": statement,
            "body": None,
            "situations": ["stacked questions"],
            "example_queries": ["how many questions"],
            "keywords": ["questions"],
            "topics": ["listening"],
            "facet_values": ["domain:ux_ui"],
            "is_global": True,
            "tenant_ids": [],
            "owner_tenant_id": None,
            "text_hash": "h1",
        },
    }
    item.update(extra)
    return item


@pytest.fixture
def vector_db():
    db = AsyncMock()
    db.collection_exists.return_value = True
    db.ensure_collection.return_value = False
    db.insert_with_named_vectors.return_value = {"succeeded": [], "failed": []}
    db.bm25_search.return_value = []
    db.named_vector_search.return_value = []
    return db


@pytest.fixture
def embedding_service():
    return AsyncMock()


@pytest.fixture
def service(vector_db, embedding_service):
    return ContextChunkService(vector_db, embedding_service)


class TestCollectionNameValidation:
    @pytest.mark.parametrize(
        "name", ["CtxFirstPrinciples_v1", "CtxCharacterInsights_v2", "CtxAb_v10"]
    )
    def test_accepts_context_library_names(self, name):
        assert validate_collection_name(name) == name

    @pytest.mark.parametrize(
        "name",
        [
            "KnowledgeChunk",
            "ReferenceDocument",
            "MigrationHistory",
            "CtxFirstPrinciples",
            "CtxFirstPrinciples_v",
            "Ctxfirst_v1",
            "CtxFirst-Principles_v1",
            "CtxFirst2_v1",
            "ctxFirst_v1",
            "CtxFirstPrinciples_v1\n",
            " CtxFirstPrinciples_v1",
            "",
        ],
    )
    def test_rejects_everything_else(self, name):
        with pytest.raises(InvalidContextCollectionName):
            validate_collection_name(name)

    @pytest.mark.asyncio
    async def test_service_validates_before_any_io(self, service, vector_db):
        with pytest.raises(InvalidContextCollectionName):
            await service.search(
                "KnowledgeChunk", [{"text": "q"}], ["bm25"], audience=EVERYONE
            )
        with pytest.raises(InvalidContextCollectionName):
            await service.delete_collection("KnowledgeChunk", "KnowledgeChunk")
        vector_db.collection_exists.assert_not_called()
        vector_db.delete_collection.assert_not_called()


class TestBulkUpsert:
    @pytest.mark.asyncio
    async def test_embeds_both_texts_in_one_call_and_writes_named_vectors(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[1.0], [2.0], [3.0], [4.0]]
        vector_db.insert_with_named_vectors.return_value = {
            "succeeded": [CHUNK_A, CHUNK_B],
            "failed": [],
        }

        result = await service.bulk_upsert(
            COLLECTION,
            [
                make_item(CHUNK_A, "first", situations_text="sit a"),
                make_item(CHUNK_B, "second", situations_text="sit b"),
            ],
        )

        assert result == {"succeeded": [CHUNK_A, CHUNK_B], "failed": []}
        embedding_service.embed_many.assert_awaited_once_with(
            ["first", "second", "sit a", "sit b"]
        )
        vector_db.ensure_collection.assert_awaited_once()
        collection, documents = vector_db.insert_with_named_vectors.call_args.args
        assert collection == COLLECTION
        assert documents[0]["id"] == CHUNK_A
        assert documents[0]["vectors"] == {"statement": [1.0], "situations": [3.0]}
        assert documents[1]["vectors"] == {"statement": [2.0], "situations": [4.0]}
        props = documents[0]["properties"]
        assert props["chunk_id"] == CHUNK_A
        assert props["facet_values"] == ["domain:ux_ui"]
        # Nullable text is stored as "", not null.
        assert props["body"] == ""
        assert props["owner_tenant_id"] == ""

    @pytest.mark.asyncio
    async def test_per_item_failures_do_not_fail_the_batch(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[1.0], [2.0]]
        vector_db.insert_with_named_vectors.return_value = {
            "succeeded": [CHUNK_A],
            "failed": [],
        }

        result = await service.bulk_upsert(
            COLLECTION,
            [
                make_item(CHUNK_A),
                make_item(CHUNK_B, statement="   "),
                make_item("not-a-uuid"),
                make_item(CHUNK_A.upper()),
            ],
        )

        assert result["succeeded"] == [CHUNK_A]
        assert result["failed"] == [
            {"chunk_id": CHUNK_B, "error": "empty statement_text"},
            {"chunk_id": "not-a-uuid", "error": "chunk_id is not a UUID"},
            {"chunk_id": CHUNK_A.upper(), "error": "duplicate chunk_id in batch"},
        ]

    @pytest.mark.asyncio
    async def test_weaviate_rejections_come_back_under_the_callers_id(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[1.0], [2.0]]
        vector_db.insert_with_named_vectors.return_value = {
            "succeeded": [],
            "failed": [{"id": CHUNK_A, "error": "boom"}],
        }

        result = await service.bulk_upsert(COLLECTION, [make_item(CHUNK_A.upper())])

        assert result == {
            "succeeded": [],
            "failed": [{"chunk_id": CHUNK_A.upper(), "error": "boom"}],
        }

    @pytest.mark.asyncio
    async def test_empty_situations_indexes_statement_vector_only(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[1.0]]
        vector_db.insert_with_named_vectors.return_value = {
            "succeeded": [CHUNK_A],
            "failed": [],
        }

        await service.bulk_upsert(COLLECTION, [make_item(situations_text="")])

        embedding_service.embed_many.assert_awaited_once_with(
            ["Ask one question at a time."]
        )
        documents = vector_db.insert_with_named_vectors.call_args.args[1]
        assert documents[0]["vectors"] == {"statement": [1.0]}

    @pytest.mark.asyncio
    async def test_embedding_failure_fails_every_item_without_raising(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.side_effect = EmbeddingFailedException("down")

        result = await service.bulk_upsert(COLLECTION, [make_item()])

        assert result["succeeded"] == []
        assert result["failed"][0]["chunk_id"] == CHUNK_A
        assert "embedding failed" in result["failed"][0]["error"]
        vector_db.insert_with_named_vectors.assert_not_called()

    @pytest.mark.asyncio
    async def test_embedding_count_mismatch_never_pairs_vectors(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[1.0]]

        result = await service.bulk_upsert(COLLECTION, [make_item()])

        assert result["failed"] == [
            {"chunk_id": CHUNK_A, "error": "embedding count mismatch"}
        ]
        vector_db.insert_with_named_vectors.assert_not_called()

    @pytest.mark.asyncio
    async def test_unreachable_weaviate_raises_before_embedding(
        self, service, vector_db, embedding_service
    ):
        vector_db.ensure_collection.side_effect = VectorDBSearchFailedException("x")

        with pytest.raises(VectorDBSearchFailedException):
            await service.bulk_upsert(COLLECTION, [make_item()])
        embedding_service.embed_many.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_invalid_items_skip_collection_creation(
        self, service, vector_db, embedding_service
    ):
        result = await service.bulk_upsert(COLLECTION, [make_item(statement="")])

        assert len(result["failed"]) == 1
        vector_db.ensure_collection.assert_not_called()
        embedding_service.embed_many.assert_not_called()


class TestSearch:
    @pytest.mark.asyncio
    async def test_one_result_per_query_and_retriever_with_one_based_ranks(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[0.1], [0.2]]
        vector_db.bm25_search.return_value = [
            {"id": CHUNK_A, "chunk_id": CHUNK_A, "score": 3.5, "facet_values": ["a"]},
            {"id": CHUNK_B, "chunk_id": CHUNK_B, "score": 1.0, "facet_values": []},
        ]
        vector_db.named_vector_search.return_value = [
            {"id": CHUNK_B, "chunk_id": CHUNK_B, "similarity": 0.8}
        ]

        results = await service.search(
            COLLECTION,
            [{"text": "q1", "vector_text": None}, {"text": "q2", "vector_text": "v2"}],
            ["bm25", "statement", "situations"],
            audience=EVERYONE,
        )

        assert [(r["query_index"], r["retriever"]) for r in results] == [
            (0, "bm25"),
            (0, "statement"),
            (0, "situations"),
            (1, "bm25"),
            (1, "statement"),
            (1, "situations"),
        ]
        assert results[0]["hits"] == [
            {"chunk_id": CHUNK_A, "rank": 1, "score": 3.5, "facet_values": ["a"]},
            {"chunk_id": CHUNK_B, "rank": 2, "score": 1.0, "facet_values": []},
        ]
        assert results[1]["hits"] == [
            {"chunk_id": CHUNK_B, "rank": 1, "score": 0.8, "facet_values": []}
        ]
        # vector_text replaces text on the vector side only, and each query is
        # embedded exactly once however many vector retrievers use it.
        embedding_service.embed_many.assert_awaited_once_with(["q1", "v2"])
        targets = [
            c.kwargs["target_vector"]
            for c in vector_db.named_vector_search.call_args_list
        ]
        assert targets == ["statement", "situations", "statement", "situations"]
        assert vector_db.bm25_search.call_args_list[1].kwargs["query"] == "q2"

    @pytest.mark.asyncio
    async def test_filters_are_passed_as_prefilters(
        self, service, vector_db, embedding_service
    ):
        await service.search(
            COLLECTION,
            [{"text": "q"}],
            ["bm25"],
            audience=ChunkAudience(tenant_id=TENANT, include_global=True),
            limit=7,
            facet_all=["domain:ux_ui", "level:intro"],
            chunk_ids=[CHUNK_A.upper()],
        )

        kwargs = vector_db.bm25_search.call_args.kwargs
        assert kwargs["collection_name"] == COLLECTION
        assert kwargs["limit"] == 7
        assert kwargs["query_properties"] == DEFAULT_BM25_PROPERTIES
        assert kwargs["filters"] == {"status": "active", "chunk_id": [CHUNK_A]}
        assert kwargs["contains_all"] == {
            "facet_values": ["domain:ux_ui", "level:intro"]
        }
        assert kwargs["any_of"] == [
            {"property": "is_global", "equal": True},
            {"property": "tenant_ids", "contains_any": [TENANT]},
        ]
        # BM25 alone needs no query vector.
        embedding_service.embed_many.assert_not_called()

    @pytest.mark.asyncio
    async def test_tenant_only_audience_and_unrestricted(self, service, vector_db):
        await service.search(
            COLLECTION,
            [{"text": "q"}],
            ["bm25"],
            audience=ChunkAudience(tenant_id=TENANT, include_global=False),
            status=None,
        )
        kwargs = vector_db.bm25_search.call_args.kwargs
        assert kwargs["any_of"] == [
            {"property": "tenant_ids", "contains_any": [TENANT]}
        ]
        assert kwargs["filters"] is None

        await service.search(COLLECTION, [{"text": "q"}], ["bm25"], audience=EVERYONE)
        assert vector_db.bm25_search.call_args.kwargs["any_of"] is None

    @pytest.mark.asyncio
    async def test_empty_audience_returns_empty_without_querying(
        self, service, vector_db, embedding_service
    ):
        results = await service.search(
            COLLECTION,
            [{"text": "q"}],
            ["bm25", "statement"],
            audience=ChunkAudience(tenant_id=None, include_global=False),
        )

        assert results == [
            {"query_index": 0, "retriever": "bm25", "hits": []},
            {"query_index": 0, "retriever": "statement", "hits": []},
        ]
        vector_db.collection_exists.assert_not_called()
        vector_db.bm25_search.assert_not_called()
        embedding_service.embed_many.assert_not_called()

    @pytest.mark.asyncio
    async def test_empty_chunk_ids_returns_empty_never_unfiltered(
        self, service, vector_db
    ):
        results = await service.search(
            COLLECTION, [{"text": "q"}], ["bm25"], audience=EVERYONE, chunk_ids=[]
        )

        assert results == [{"query_index": 0, "retriever": "bm25", "hits": []}]
        vector_db.bm25_search.assert_not_called()

    @pytest.mark.asyncio
    async def test_missing_collection_is_empty_not_an_error(
        self, service, vector_db, embedding_service
    ):
        vector_db.collection_exists.return_value = False

        results = await service.search(
            COLLECTION, [{"text": "q"}], ["statement"], audience=EVERYONE
        )

        assert results == [{"query_index": 0, "retriever": "statement", "hits": []}]
        embedding_service.embed_many.assert_not_called()
        vector_db.named_vector_search.assert_not_called()

    @pytest.mark.asyncio
    async def test_any_retriever_failure_raises(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.return_value = [[0.1]]
        vector_db.named_vector_search.side_effect = VectorDBSearchFailedException("x")

        with pytest.raises(VectorDBSearchFailedException):
            await service.search(
                COLLECTION, [{"text": "q"}], ["bm25", "statement"], audience=EVERYONE
            )

    @pytest.mark.asyncio
    async def test_unexpected_retriever_error_is_a_search_failure(
        self, service, vector_db
    ):
        vector_db.bm25_search.side_effect = RuntimeError("grpc")

        with pytest.raises(VectorDBSearchFailedException):
            await service.search(
                COLLECTION, [{"text": "q"}], ["bm25"], audience=EVERYONE
            )

    @pytest.mark.asyncio
    async def test_query_embedding_failure_raises(
        self, service, vector_db, embedding_service
    ):
        embedding_service.embed_many.side_effect = RuntimeError("openai")

        with pytest.raises(EmbeddingFailedException):
            await service.search(
                COLLECTION, [{"text": "q"}], ["situations"], audience=EVERYONE
            )


class TestListIdsAndDelete:
    @pytest.mark.asyncio
    async def test_list_ids_offers_a_cursor_only_on_a_full_page(
        self, service, vector_db
    ):
        vector_db.list_ids_with_properties.return_value = [
            {"id": CHUNK_A, "chunk_id": CHUNK_A, "text_hash": "h1"},
            {"id": CHUNK_B, "chunk_id": CHUNK_B, "text_hash": "h2"},
        ]

        full = await service.list_ids(COLLECTION, limit=2)
        short = await service.list_ids(COLLECTION, limit=3, after=CHUNK_A)

        assert full == {
            "items": [
                {"chunk_id": CHUNK_A, "text_hash": "h1"},
                {"chunk_id": CHUNK_B, "text_hash": "h2"},
            ],
            "next": CHUNK_B,
        }
        assert short["next"] is None
        assert vector_db.list_ids_with_properties.call_args.kwargs["after"] == CHUNK_A

    @pytest.mark.asyncio
    async def test_list_ids_of_missing_collection_is_empty(self, service, vector_db):
        vector_db.collection_exists.return_value = False

        assert await service.list_ids(COLLECTION) == {"items": [], "next": None}
        vector_db.list_ids_with_properties.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_canonicalises_ids(self, service, vector_db):
        vector_db.delete_by_property_values.return_value = 1

        assert await service.delete(COLLECTION, [CHUNK_A.upper()]) == 1
        vector_db.delete_by_property_values.assert_awaited_once_with(
            COLLECTION, "chunk_id", [CHUNK_A]
        )

    @pytest.mark.asyncio
    async def test_delete_from_missing_collection_is_zero(self, service, vector_db):
        vector_db.collection_exists.return_value = False

        assert await service.delete(COLLECTION, [CHUNK_A]) == 0
        vector_db.delete_by_property_values.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_refuses_an_empty_list(self, service, vector_db):
        with pytest.raises(ValueError):
            await service.delete(COLLECTION, [])
        vector_db.delete_by_property_values.assert_not_called()


class TestDeleteCollection:
    @pytest.mark.parametrize(
        "confirm", [None, "", "CtxFirstPrinciples_v2", "ctxfirstprinciples_v1"]
    )
    @pytest.mark.asyncio
    async def test_refuses_without_exact_confirmation(
        self, service, vector_db, confirm
    ):
        with pytest.raises(ConfirmationMismatch):
            await service.delete_collection(COLLECTION, confirm)
        vector_db.delete_collection.assert_not_called()

    @pytest.mark.asyncio
    async def test_deletes_when_confirmed(self, service, vector_db):
        vector_db.delete_collection.return_value = True

        assert await service.delete_collection(COLLECTION, COLLECTION) is True
        vector_db.delete_collection.assert_awaited_once_with(COLLECTION)


class TestEmbed:
    @pytest.mark.asyncio
    async def test_returns_vectors_and_model(self, service, embedding_service):
        embedding_service.embed_many.return_value = [[0.1], [0.2]]

        result = await service.embed(["a", "b"])

        assert result == {
            "vectors": [[0.1], [0.2]],
            "model": "text-embedding-3-small",
        }

    @pytest.mark.asyncio
    async def test_count_mismatch_raises(self, service, embedding_service):
        embedding_service.embed_many.return_value = [[0.1]]

        with pytest.raises(EmbeddingFailedException):
            await service.embed(["a", "b"])
