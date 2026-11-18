"""Tests for the WeaviateDB primitives added for the Context Library.

Mocked at the client, as tests/core/vector_db/test_weaviate.py does. The behaviours that
matter: filters reach Weaviate as PRE-filters with the right operators, an empty
disjunction never becomes an unfiltered query, per-object insert errors map back to
ids, and an outage is never reported as "no such collection".
"""

from unittest.mock import AsyncMock, MagicMock

import pytest
from weaviate.classes.query import Filter
from weaviate.exceptions import WeaviateInsertManyAllFailedError

from app.core.context_library.collection_schema import collection_create_kwargs
from app.core.vector_db.weaviate import WeaviateDB
from app.exceptions.custom_exceptions import (
    VectorDBDeleteFailedException,
    VectorDBInsertFailedException,
    VectorDBSearchFailedException,
)

NAME = "CtxFirstPrinciples_v1"
ID_A = "11111111-1111-1111-1111-111111111111"
ID_B = "22222222-2222-2222-2222-222222222222"


def obj(uuid, properties=None, **metadata):
    return MagicMock(
        uuid=uuid, properties=properties or {}, metadata=MagicMock(**metadata)
    )


def _shape(f):
    """A comparable form of a filter tree: And/Or nodes have no __eq__, leaves do."""
    children = getattr(f, "filters", None)
    if isinstance(children, list):
        return (type(f).__name__, [_shape(c) for c in children])
    return f


@pytest.fixture
def collection():
    c = MagicMock()
    c.query.bm25 = AsyncMock(return_value=MagicMock(objects=[]))
    c.query.near_vector = AsyncMock(return_value=MagicMock(objects=[]))
    c.query.fetch_objects = AsyncMock(return_value=MagicMock(objects=[]))
    c.data.insert_many = AsyncMock(return_value=MagicMock(errors={}))
    c.data.delete_many = AsyncMock(return_value=MagicMock(successful=2, failed=0))
    return c


@pytest.fixture
def db(collection):
    client = MagicMock()
    client.collections.get.return_value = collection
    client.collections.exists = AsyncMock(return_value=True)
    client.collections.create = AsyncMock()
    client.collections.delete = AsyncMock()
    return WeaviateDB(client, AsyncMock())


class TestCollectionLifecycle:
    @pytest.mark.asyncio
    async def test_exists_failure_is_an_outage_not_false(self, db):
        db.client.collections.exists.side_effect = RuntimeError("down")
        with pytest.raises(VectorDBSearchFailedException):
            await db.collection_exists(NAME)

    @pytest.mark.asyncio
    async def test_ensure_creates_only_when_missing(self, db):
        assert await db.ensure_collection(NAME, **collection_create_kwargs()) is False
        db.client.collections.create.assert_not_called()

        db.client.collections.exists.return_value = False
        assert await db.ensure_collection(NAME, **collection_create_kwargs()) is True
        kwargs = db.client.collections.create.call_args.kwargs
        assert kwargs["name"] == NAME
        assert [v.name for v in kwargs["vector_config"]] == ["statement", "situations"]

    @pytest.mark.asyncio
    async def test_ensure_tolerates_a_concurrent_create(self, db):
        db.client.collections.exists.side_effect = [False, True]
        db.client.collections.create.side_effect = RuntimeError("already exists")

        assert await db.ensure_collection(NAME) is False

    @pytest.mark.asyncio
    async def test_ensure_raises_when_create_really_failed(self, db):
        db.client.collections.exists.return_value = False
        db.client.collections.create.side_effect = RuntimeError("bad config")

        with pytest.raises(VectorDBInsertFailedException):
            await db.ensure_collection(NAME)

    @pytest.mark.asyncio
    async def test_delete_collection(self, db):
        assert await db.delete_collection(NAME) is True
        db.client.collections.delete.assert_awaited_once_with(NAME)

        db.client.collections.delete.reset_mock()
        db.client.collections.exists.return_value = False
        assert await db.delete_collection(NAME) is False
        db.client.collections.delete.assert_not_called()

    @pytest.mark.asyncio
    async def test_delete_collection_failure_raises(self, db):
        db.client.collections.delete.side_effect = RuntimeError("x")
        with pytest.raises(VectorDBDeleteFailedException):
            await db.delete_collection(NAME)


class TestInsertWithNamedVectors:
    @pytest.mark.asyncio
    async def test_maps_per_object_errors_back_to_ids(self, db, collection):
        collection.data.insert_many.return_value = MagicMock(
            errors={1: MagicMock(message="rejected")}
        )

        result = await db.insert_with_named_vectors(
            NAME,
            [
                {"id": ID_A, "properties": {}, "vectors": {"statement": [1.0]}},
                {"id": ID_B, "properties": {}, "vectors": {"statement": [2.0]}},
            ],
        )

        assert result == {
            "succeeded": [ID_A],
            "failed": [{"id": ID_B, "error": "rejected"}],
        }
        batch = collection.data.insert_many.call_args.args[0]
        assert batch[0].vector == {"statement": [1.0]}

    @pytest.mark.asyncio
    async def test_refuses_objects_without_any_vector(self, db, collection):
        result = await db.insert_with_named_vectors(
            NAME, [{"id": ID_A, "properties": {}, "vectors": {"statement": []}}]
        )

        assert result["failed"][0]["id"] == ID_A
        collection.data.insert_many.assert_not_called()

    @pytest.mark.asyncio
    async def test_all_failed_is_per_object_not_a_request_failure(self, db, collection):
        collection.data.insert_many.side_effect = WeaviateInsertManyAllFailedError(
            "all failed"
        )

        result = await db.insert_with_named_vectors(
            NAME, [{"id": ID_A, "properties": {}, "vectors": {"statement": [1.0]}}]
        )

        assert result["succeeded"] == []
        assert result["failed"][0]["id"] == ID_A

    @pytest.mark.asyncio
    async def test_transport_failure_raises(self, db, collection):
        collection.data.insert_many.side_effect = RuntimeError("down")
        with pytest.raises(VectorDBInsertFailedException):
            await db.insert_with_named_vectors(
                NAME, [{"id": ID_A, "properties": {}, "vectors": {"statement": [1.0]}}]
            )


class TestSearchPrimitives:
    @pytest.mark.asyncio
    async def test_bm25_returns_scores_in_rank_order(self, db, collection):
        collection.query.bm25.return_value = MagicMock(
            objects=[obj(ID_A, {"chunk_id": ID_A}, score=2.5), obj(ID_B, score=None)]
        )

        hits = await db.bm25_search(
            NAME, "q", query_properties=["statement^2"], limit=5
        )

        assert [(h["id"], h["score"]) for h in hits] == [(ID_A, 2.5), (ID_B, 0.0)]
        kwargs = collection.query.bm25.call_args.kwargs
        assert kwargs["query"] == "q"
        assert kwargs["query_properties"] == ["statement^2"]
        assert kwargs["limit"] == 5
        assert kwargs["filters"] is None

    @pytest.mark.asyncio
    async def test_named_vector_search_targets_one_vector(self, db, collection):
        collection.query.near_vector.return_value = MagicMock(
            objects=[obj(ID_A, distance=0.25)]
        )

        hits = await db.named_vector_search(NAME, [0.1], "situations", limit=3)

        assert hits == [{"id": ID_A, "similarity": 0.75}]
        kwargs = collection.query.near_vector.call_args.kwargs
        assert kwargs["target_vector"] == "situations"
        # No similarity floor: rank fusion downstream decides what a weak hit is worth.
        assert "distance" not in kwargs

    @pytest.mark.asyncio
    async def test_empty_disjunction_matches_nothing_without_io(self, db, collection):
        assert await db.bm25_search(NAME, "q", any_of=[]) == []
        assert await db.named_vector_search(NAME, [0.1], "statement", any_of=[]) == []
        collection.query.bm25.assert_not_called()
        collection.query.near_vector.assert_not_called()

    @pytest.mark.asyncio
    async def test_search_failure_raises(self, db, collection):
        collection.query.bm25.side_effect = RuntimeError("grpc")
        with pytest.raises(VectorDBSearchFailedException):
            await db.bm25_search(NAME, "q")

    def test_compose_filters_ands_every_kind(self):
        composed = WeaviateDB._compose_filters(
            {"status": "active", "chunk_id": [ID_A, ID_B]},
            [
                {"property": "is_global", "equal": True},
                {"property": "tenant_ids", "contains_any": ["t1"]},
            ],
            {"facet_values": ["domain:ux_ui"]},
        )
        expected = Filter.all_of(
            [
                Filter.all_of(
                    [
                        Filter.by_property("status").equal("active"),
                        Filter.any_of(
                            [
                                Filter.by_property("chunk_id").equal(ID_A),
                                Filter.by_property("chunk_id").equal(ID_B),
                            ]
                        ),
                    ]
                ),
                Filter.any_of(
                    [
                        Filter.by_property("is_global").equal(True),
                        Filter.by_property("tenant_ids").contains_any(["t1"]),
                    ]
                ),
                Filter.by_property("facet_values").contains_all(["domain:ux_ui"]),
            ]
        )
        assert _shape(composed) == _shape(expected)

    def test_compose_filters_nothing_is_none(self):
        assert WeaviateDB._compose_filters(None, None, {"facet_values": []}) is None


class TestIdsAndDeletes:
    @pytest.mark.asyncio
    async def test_list_ids_with_properties_uses_the_cursor(self, db, collection):
        collection.query.fetch_objects.return_value = MagicMock(
            objects=[obj(ID_B, {"chunk_id": ID_B, "text_hash": "h"})]
        )

        rows = await db.list_ids_with_properties(
            NAME, ["chunk_id", "text_hash"], limit=1, after=ID_A
        )

        assert rows == [{"id": ID_B, "chunk_id": ID_B, "text_hash": "h"}]
        kwargs = collection.query.fetch_objects.call_args.kwargs
        assert kwargs["after"] == ID_A
        assert kwargs["return_properties"] == ["chunk_id", "text_hash"]

    @pytest.mark.asyncio
    async def test_delete_by_property_values(self, db, collection):
        assert await db.delete_by_property_values(NAME, "chunk_id", [ID_A, ID_B]) == 2

    @pytest.mark.asyncio
    async def test_delete_by_property_values_refuses_empty(self, db, collection):
        with pytest.raises(ValueError):
            await db.delete_by_property_values(NAME, "chunk_id", [])
        collection.data.delete_many.assert_not_called()
