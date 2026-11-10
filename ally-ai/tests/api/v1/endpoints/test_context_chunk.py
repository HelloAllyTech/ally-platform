"""Tests for the /context-chunks endpoints.

Service methods are patched on the CLASS, as in test_knowledge_chunk.py: FastAPI binds
`Depends(get_context_chunk_service)` at import time, so patching the dependency function
would not reach an already-registered route.
"""

from unittest.mock import patch
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient

from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    VectorDBDeleteFailedException,
    VectorDBInsertFailedException,
    VectorDBSearchFailedException,
)
from tests.api.v1.endpoints.base import BaseAPITest

SERVICE = "app.core.context_library.context_chunk_service.ContextChunkService"
BASE = "/api/v1/context-chunks"
COLLECTION = "CtxFirstPrinciples_v1"
Q = f"?collection={COLLECTION}"


class _ResolvedKeyAPITest(BaseAPITest):
    """A client whose API key is the one AuthMiddleware reads from settings (see
    test_knowledge_chunk.py for why a literal key is wrong somewhere)."""

    @pytest.fixture
    def client(self):
        from app.core.config import settings
        from app.main import app

        test_client = TestClient(app)
        test_client.headers.update({"x-api-key": settings.API.X_API_KEY})
        return test_client


def upsert_item(**overrides):
    item = {
        "chunk_id": str(uuid4()),
        "statement_text": "Ask one question at a time.",
        "situations_text": "When questions are stacked.",
        "properties": {
            "code": "FP-001",
            "collection_id": "c1",
            "status": "active",
            "statement": "Ask one question at a time.",
            "body": None,
            "situations": ["stacked questions"],
            "example_queries": [],
            "keywords": ["questions"],
            "topics": [],
            "facet_values": ["domain:ux_ui"],
            "is_global": True,
            "tenant_ids": [],
            "owner_tenant_id": None,
            "text_hash": "h1",
        },
    }
    item.update(overrides)
    return item


def search_body(**overrides):
    body = {"queries": [{"text": "stacked questions"}], "retrievers": ["bm25"]}
    body.update(overrides)
    return body


class TestCollectionParameter(_ResolvedKeyAPITest):
    @pytest.mark.parametrize(
        "name", ["KnowledgeChunk", "CtxFirstPrinciples", "ctxFoo_v1", "Ctx_v1"]
    )
    def test_names_outside_the_namespace_are_400(self, client, name):
        with patch(f"{SERVICE}.search") as mock_search:
            response = client.post(
                f"{BASE}/search?collection={name}", json=search_body()
            )
        assert response.status_code == 400
        mock_search.assert_not_called()

    def test_missing_collection_parameter_is_422(self, client):
        response = client.post(f"{BASE}/search", json=search_body())
        assert response.status_code == 422

    def test_every_collection_route_is_guarded(self, client):
        bad = "?collection=KnowledgeChunk"
        assert (
            client.post(
                f"{BASE}/bulk-upsert{bad}", json={"items": [upsert_item()]}
            ).status_code
            == 400
        )
        assert (
            client.post(f"{BASE}/delete{bad}", json={"chunk_ids": ["x"]}).status_code
            == 400
        )
        assert client.get(f"{BASE}/ids{bad}").status_code == 400
        assert (
            client.delete(f"{BASE}/collection{bad}&confirm=KnowledgeChunk").status_code
            == 400
        )

    def test_requires_api_key(self, client):
        client.headers.pop("x-api-key")
        response = client.post(f"{BASE}/search{Q}", json=search_body())
        assert response.status_code in (401, 403)


class TestBulkUpsert(_ResolvedKeyAPITest):
    def test_partial_failure_is_200_with_detail(self, client):
        ok, bad = upsert_item(), upsert_item(statement_text="")
        with patch(f"{SERVICE}.bulk_upsert") as mock_upsert:
            mock_upsert.return_value = {
                "succeeded": [ok["chunk_id"]],
                "failed": [
                    {"chunk_id": bad["chunk_id"], "error": "empty statement_text"}
                ],
            }
            response = client.post(f"{BASE}/bulk-upsert{Q}", json={"items": [ok, bad]})

        assert response.status_code == 200
        assert response.json() == {
            "succeeded": [ok["chunk_id"]],
            "failed": [{"chunk_id": bad["chunk_id"], "error": "empty statement_text"}],
        }
        assert mock_upsert.call_args.args[0] == COLLECTION

    def test_more_than_100_items_is_422(self, client):
        response = client.post(
            f"{BASE}/bulk-upsert{Q}",
            json={"items": [upsert_item() for _ in range(101)]},
        )
        assert response.status_code == 422

    def test_missing_text_hash_is_422(self, client):
        item = upsert_item()
        del item["properties"]["text_hash"]
        response = client.post(f"{BASE}/bulk-upsert{Q}", json={"items": [item]})
        assert response.status_code == 422

    @pytest.mark.parametrize(
        "error", [VectorDBInsertFailedException("x"), VectorDBSearchFailedException()]
    )
    def test_unreachable_weaviate_is_503(self, client, error):
        with patch(f"{SERVICE}.bulk_upsert", side_effect=error):
            response = client.post(
                f"{BASE}/bulk-upsert{Q}", json={"items": [upsert_item()]}
            )
        assert response.status_code == 503
        assert "Status Code" not in response.json()["detail"]


class TestDelete(_ResolvedKeyAPITest):
    def test_delete(self, client):
        with patch(f"{SERVICE}.delete", return_value=2) as mock_delete:
            response = client.post(f"{BASE}/delete{Q}", json={"chunk_ids": ["a", "b"]})
        assert response.status_code == 200
        assert response.json() == {"deleted": 2}
        mock_delete.assert_awaited_once_with(COLLECTION, ["a", "b"])

    def test_empty_list_is_422(self, client):
        response = client.post(f"{BASE}/delete{Q}", json={"chunk_ids": []})
        assert response.status_code == 422

    def test_failure_is_503(self, client):
        with patch(f"{SERVICE}.delete", side_effect=VectorDBDeleteFailedException()):
            response = client.post(f"{BASE}/delete{Q}", json={"chunk_ids": ["a"]})
        assert response.status_code == 503


class TestIds(_ResolvedKeyAPITest):
    def test_page(self, client):
        cursor = str(uuid4())
        page = {"items": [{"chunk_id": cursor, "text_hash": "h"}], "next": cursor}
        with patch(f"{SERVICE}.list_ids", return_value=page) as mock_ids:
            response = client.get(f"{BASE}/ids{Q}&limit=1&after={cursor}")
        assert response.status_code == 200
        assert response.json() == page
        mock_ids.assert_awaited_once_with(COLLECTION, limit=1, after=cursor)

    @pytest.mark.parametrize("limit", [0, 501])
    def test_limit_bounds(self, client, limit):
        response = client.get(f"{BASE}/ids{Q}&limit={limit}")
        assert response.status_code == 422

    def test_malformed_cursor_is_422(self, client):
        response = client.get(f"{BASE}/ids{Q}&after=not-a-uuid")
        assert response.status_code == 422

    def test_failure_is_503(self, client):
        with patch(f"{SERVICE}.list_ids", side_effect=VectorDBSearchFailedException()):
            response = client.get(f"{BASE}/ids{Q}")
        assert response.status_code == 503


class TestSearch(_ResolvedKeyAPITest):
    def test_defaults_and_shape(self, client):
        results = [
            {
                "query_index": 0,
                "retriever": "bm25",
                "hits": [
                    {
                        "chunk_id": "a",
                        "rank": 1,
                        "score": 2.0,
                        "facet_values": ["domain:ux_ui"],
                    }
                ],
            }
        ]
        with patch(f"{SERVICE}.search", return_value=results) as mock_search:
            response = client.post(f"{BASE}/search{Q}", json=search_body())

        assert response.status_code == 200
        assert response.json() == {"results": results}
        kwargs = mock_search.call_args.kwargs
        assert kwargs["limit"] == 30
        assert kwargs["status"] == "active"
        assert kwargs["bm25_properties"] is None
        assert kwargs["chunk_ids"] is None
        # A null audience is the explicit unrestricted case.
        assert kwargs["audience"].ignore_targeting is True
        assert kwargs["queries"] == [{"text": "stacked questions", "vector_text": None}]

    def test_audience_maps_to_chunk_audience(self, client):
        body = search_body(audience={"tenant_id": "t1", "include_global": False})
        with patch(f"{SERVICE}.search", return_value=[]) as mock_search:
            response = client.post(f"{BASE}/search{Q}", json=body)
        assert response.status_code == 200
        audience = mock_search.call_args.kwargs["audience"]
        assert audience.to_any_of() == [
            {"property": "tenant_ids", "contains_any": ["t1"]}
        ]

    def test_empty_audience_is_accepted_not_422(self, client):
        """Unlike /knowledge-chunks, an audience matching nothing is a legitimate
        empty search here; the service short-circuits it."""
        body = search_body(audience={"tenant_id": None, "include_global": False})
        with patch(f"{SERVICE}.search", return_value=[]):
            response = client.post(f"{BASE}/search{Q}", json=body)
        assert response.status_code == 200

    @pytest.mark.parametrize(
        "overrides",
        [
            {"queries": []},
            {"queries": [{"text": "q"}] * 7},
            {"queries": [{"text": "   "}]},
            {"queries": [{"text": "q", "vector_text": ""}]},
            {"retrievers": []},
            {"retrievers": ["bm25", "bm25"]},
            {"retrievers": ["dense"]},
            {"limit": 0},
            {"limit": 101},
            {"bm25_properties": []},
            {"bm25_properties": ["chunk_id"]},
            {"bm25_properties": ["statement^x"]},
            {"status": "draft"},
        ],
    )
    def test_validation_errors_are_422(self, client, overrides):
        with patch(f"{SERVICE}.search") as mock_search:
            response = client.post(f"{BASE}/search{Q}", json=search_body(**overrides))
        assert response.status_code == 422
        mock_search.assert_not_called()

    def test_accepts_boosted_properties_and_null_status(self, client):
        body = search_body(
            bm25_properties=["statement^2", "example_queries^1.5", "body"],
            status=None,
            facet_all=["domain:ux_ui"],
            chunk_ids=[],
        )
        with patch(f"{SERVICE}.search", return_value=[]) as mock_search:
            response = client.post(f"{BASE}/search{Q}", json=body)
        assert response.status_code == 200
        kwargs = mock_search.call_args.kwargs
        assert kwargs["status"] is None
        assert kwargs["chunk_ids"] == []

    @pytest.mark.parametrize(
        "error",
        [VectorDBSearchFailedException(), EmbeddingFailedException("x")],
    )
    def test_retrieval_failure_is_503_saying_so(self, client, error):
        with patch(f"{SERVICE}.search", side_effect=error):
            response = client.post(f"{BASE}/search{Q}", json=search_body())
        assert response.status_code == 503
        assert "retrieval failed" in response.json()["detail"].lower()


class TestEmbed(_ResolvedKeyAPITest):
    def test_embed(self, client):
        result = {"vectors": [[0.1, 0.2]], "model": "text-embedding-3-small"}
        with patch(f"{SERVICE}.embed", return_value=result):
            response = client.post(f"{BASE}/embed", json={"texts": ["a"]})
        assert response.status_code == 200
        assert response.json() == result

    @pytest.mark.parametrize("texts", [[], [""], ["  "], ["a"] * 101])
    def test_validation(self, client, texts):
        response = client.post(f"{BASE}/embed", json={"texts": texts})
        assert response.status_code == 422

    def test_provider_failure_is_502(self, client):
        with patch(f"{SERVICE}.embed", side_effect=EmbeddingFailedException("x")):
            response = client.post(f"{BASE}/embed", json={"texts": ["a"]})
        assert response.status_code == 502


class TestDeleteCollection(_ResolvedKeyAPITest):
    @pytest.mark.parametrize("confirm", ["", "&confirm=", "&confirm=CtxOther_v1"])
    def test_requires_exact_confirmation(self, client, confirm):
        """The real service guard, unpatched: nothing may reach Weaviate."""
        with patch(
            "app.core.vector_db.weaviate.WeaviateDB.delete_collection"
        ) as mock_drop:
            response = client.delete(f"{BASE}/collection{Q}{confirm}")
        assert response.status_code == 400
        mock_drop.assert_not_called()

    @pytest.mark.parametrize("deleted", [True, False])
    def test_deleted_flag(self, client, deleted):
        with patch(f"{SERVICE}.delete_collection", return_value=deleted) as mock_drop:
            response = client.delete(f"{BASE}/collection{Q}&confirm={COLLECTION}")
        assert response.status_code == 200
        assert response.json() == {"deleted": deleted}
        mock_drop.assert_awaited_once_with(COLLECTION, COLLECTION)
