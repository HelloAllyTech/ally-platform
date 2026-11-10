"""Write, reconcile and retrieve side of the Context Library's Weaviate indexes.

ally-be's Postgres `cl_chunks` is the system of record; every collection touched here is
a DERIVED index of it. Consequences worth knowing:

  * The Weaviate object UUID IS the chunk id, so every write is an idempotent upsert and
    a hit resolves straight back to its row.
  * Nothing here decides what is stale. ally-be compares the `text_hash` that `list_ids`
    returns against its own rows and re-sends or deletes on its own judgement.
  * Retrieval is raw: one ranked list per (query, retriever), no fusion and no
    thresholds. ally-be fuses ranks across retrievers, so a floor applied here would
    drop hits before fusion could weigh them.
  * A collection that does not exist yet is an EMPTY index, not an error, on every read.
    A Weaviate failure, on the other hand, is always raised: "could not look" must never
    reach ally-be dressed as "the library holds nothing on this".

The collection name is request data, so every public method validates it first (see
collection_schema.py). One service instance serves every collection, unlike
KnowledgeChunkService's one-per-corpus: the set of names is open-ended (each rebuild
writes a new version), so a per-name instance cache would be unbounded.
"""

import asyncio
from typing import Any, Dict, List, Optional
from uuid import UUID

from app.core.constants import EmbeddingConstants
from app.core.context_library.collection_schema import (
    DEFAULT_BM25_PROPERTIES,
    SITUATIONS_VECTOR,
    STATEMENT_VECTOR,
    collection_create_kwargs,
    validate_collection_name,
)
from app.core.embeddings.base import BaseEmbeddingService
from app.core.knowledge_base.knowledge_chunk_service import ChunkAudience
from app.core.vector_db.weaviate import WeaviateDB
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    VectorDBSearchFailedException,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

BM25 = "bm25"
#: Retriever name -> the named vector it searches. BM25 is the one retriever without.
VECTOR_RETRIEVERS = {
    STATEMENT_VECTOR: STATEMENT_VECTOR,
    SITUATIONS_VECTOR: SITUATIONS_VECTOR,
}
RETRIEVERS = (BM25, *VECTOR_RETRIEVERS)

#: What a hit carries back. ally-be needs only the id to fuse and the facets to
#: diversify; the chunk text it already holds.
_HIT_PROPERTIES = ["chunk_id", "facet_values"]


class ConfirmationMismatch(ValueError):
    """`delete_collection` was not confirmed with the exact collection name."""


def _canonical_id(value: str) -> str:
    """
    The lowercase hyphenated form of a UUID string, or the input unchanged when it is
    not one.

    Weaviate stores object UUIDs canonically, and `chunk_id` filters are exact (FIELD
    tokenisation), so an id that arrived upper-cased would otherwise silently match
    nothing on delete or pre-filter. A non-UUID is left alone: as a filter value it
    matches nothing, which is the honest answer.
    """
    try:
        return str(UUID(str(value)))
    except (ValueError, AttributeError, TypeError):
        return str(value)


class ContextChunkService:
    """Indexing and retrieval for every Context Library collection."""

    def __init__(
        self, vector_db: WeaviateDB, embedding_service: BaseEmbeddingService
    ) -> None:
        self.vector_db = vector_db
        self.embedding_service = embedding_service

    # ---- writes ----

    async def bulk_upsert(
        self, collection: str, items: List[Dict[str, Any]]
    ) -> Dict[str, Any]:
        """
        Embed and insert-or-replace a batch of chunks, creating the collection first if
        this is its first write.

        Returns ``{"succeeded": [chunk_id], "failed": [{"chunk_id", "error"}]}`` and
        never raises for a per-item problem — an empty statement, a malformed id, a
        failed embedding. ally-be retries only what is in `failed`, so a batch that
        reported blanket success while dropping items would leave the index short with
        nothing to say so. Only a failure to reach Weaviate at all is raised.

        Both texts of every item go to the embedding service in ONE call (2N texts, or
        fewer when some `situations_text` is empty). An item whose `situations_text` is
        empty is still indexed, with the statement vector only: it stays reachable by
        BM25 and the statement retriever, and the situations retriever correctly has
        nothing to match it on. Fabricating that vector from the statement would make
        the two retrievers agree for a reason that is not evidence.
        """
        validate_collection_name(collection)

        failed: List[Dict[str, str]] = []
        accepted: List[Dict[str, Any]] = []
        seen: set[str] = set()
        for item in items:
            chunk_id = str(item.get("chunk_id") or "")
            statement_text = (item.get("statement_text") or "").strip()
            try:
                object_id = str(UUID(chunk_id))
            except ValueError:
                failed.append({"chunk_id": chunk_id, "error": "chunk_id is not a UUID"})
                continue
            if not statement_text:
                failed.append({"chunk_id": chunk_id, "error": "empty statement_text"})
                continue
            if object_id in seen:
                # Two objects with one UUID in a batch: whichever Weaviate wrote last
                # would win, silently. The caller should never send this, so say so.
                failed.append(
                    {"chunk_id": chunk_id, "error": "duplicate chunk_id in batch"}
                )
                continue
            seen.add(object_id)
            accepted.append(
                {
                    **item,
                    "chunk_id": chunk_id,
                    "object_id": object_id,
                    "statement_text": statement_text,
                    "situations_text": (item.get("situations_text") or "").strip(),
                }
            )

        if not accepted:
            return {"succeeded": [], "failed": failed}

        # Before embedding, so an unreachable Weaviate costs no embedding spend. Raises
        # on failure: this is the whole-request case the endpoint turns into a 503.
        await self.vector_db.ensure_collection(collection, **collection_create_kwargs())

        texts: List[str] = [item["statement_text"] for item in accepted]
        situations_at: Dict[int, int] = {}
        for index, item in enumerate(accepted):
            if item["situations_text"]:
                situations_at[index] = len(texts)
                texts.append(item["situations_text"])

        try:
            vectors = await self.embedding_service.embed_many(texts)
        except Exception as e:
            logger.exception(f"Context chunk embedding failed: {type(e).__name__}")
            failed.extend(
                {
                    "chunk_id": item["chunk_id"],
                    "error": f"embedding failed: {type(e).__name__}",
                }
                for item in accepted
            )
            return {"succeeded": [], "failed": failed}

        if len(vectors) != len(texts):
            # Never pair mismatched lists: a chunk retrievable under another chunk's
            # vector is plausible and wrong, which is worse than failing.
            logger.error(
                f"Embedding count mismatch: asked for {len(texts)}, got {len(vectors)}"
            )
            failed.extend(
                {"chunk_id": item["chunk_id"], "error": "embedding count mismatch"}
                for item in accepted
            )
            return {"succeeded": [], "failed": failed}

        documents: List[Dict[str, Any]] = []
        original_id: Dict[str, str] = {}
        for index, item in enumerate(accepted):
            named = {STATEMENT_VECTOR: vectors[index]}
            if index in situations_at:
                named[SITUATIONS_VECTOR] = vectors[situations_at[index]]
            documents.append(
                {
                    "id": item["object_id"],
                    "vectors": named,
                    "properties": self._to_properties(
                        item["object_id"], item.get("properties") or {}
                    ),
                }
            )
            original_id[item["object_id"]] = item["chunk_id"]

        result = await self.vector_db.insert_with_named_vectors(collection, documents)

        succeeded = [original_id.get(i, i) for i in result.get("succeeded", [])]
        failed.extend(
            {"chunk_id": original_id.get(f["id"], f["id"]), "error": f["error"]}
            for f in result.get("failed", [])
        )
        return {"succeeded": succeeded, "failed": failed}

    @staticmethod
    def _to_properties(object_id: str, props: Dict[str, Any]) -> Dict[str, Any]:
        """
        The stored property set. `chunk_id` is written from the canonical object id so
        that filtering on the property and on the UUID can never disagree.

        Nullable text is stored as "" rather than null, as KnowledgeChunk does: a null
        does not survive a Weaviate round trip cleanly. `is_global` defaults to the
        CLOSED value — a chunk nobody can retrieve is a visible bug, a chunk everybody
        can is an invisible leak.
        """

        def strings(key: str) -> List[str]:
            return [str(v) for v in (props.get(key) or [])]

        return {
            "chunk_id": object_id,
            "code": str(props.get("code") or ""),
            "collection_id": str(props.get("collection_id") or ""),
            "status": str(props.get("status") or ""),
            "statement": str(props.get("statement") or ""),
            "body": str(props.get("body") or ""),
            "situations": strings("situations"),
            "example_queries": strings("example_queries"),
            "keywords": strings("keywords"),
            "topics": strings("topics"),
            "facet_values": strings("facet_values"),
            "is_global": bool(props.get("is_global") or False),
            "tenant_ids": strings("tenant_ids"),
            "owner_tenant_id": str(props.get("owner_tenant_id") or ""),
            "text_hash": str(props.get("text_hash") or ""),
        }

    async def delete(self, collection: str, chunk_ids: List[str]) -> int:
        """
        Remove these chunks; returns how many went. 0 is a legitimate answer — the
        caller's intent is "make sure these are gone", which a missing collection or an
        already-deleted id satisfies.
        """
        validate_collection_name(collection)
        if not chunk_ids:
            raise ValueError("delete requires at least one chunk_id")
        if not await self.vector_db.collection_exists(collection):
            return 0
        return await self.vector_db.delete_by_property_values(
            collection, "chunk_id", [_canonical_id(c) for c in chunk_ids]
        )

    async def delete_collection(self, collection: str, confirm: Optional[str]) -> bool:
        """
        Drop a whole collection (blue/green cleanup after ally-be switches versions).

        `confirm` must repeat the name exactly. One query parameter is easy to get wrong
        by a variable; having to say the same name twice is what turns "drop the index
        being served from" from a typo into a decision.
        """
        validate_collection_name(collection)
        if confirm != collection:
            raise ConfirmationMismatch("confirm must equal collection exactly")
        deleted = await self.vector_db.delete_collection(collection)
        logger.info(f"delete_collection {collection}: deleted={deleted}")
        return deleted

    # ---- reads ----

    async def list_ids(
        self, collection: str, limit: int = 200, after: Optional[str] = None
    ) -> Dict[str, Any]:
        """
        One cursor page of ``{"chunk_id", "text_hash"}`` for ally-be's reconciliation.

        The only read that can surface an object ally-be has FORGOTTEN (a row deleted
        without its vector), and, through `text_hash`, one whose text changed without a
        re-embed. `next` is offered only on a full page; a short page is the end.
        """
        validate_collection_name(collection)
        if not await self.vector_db.collection_exists(collection):
            return {"items": [], "next": None}

        rows = await self.vector_db.list_ids_with_properties(
            collection, ["chunk_id", "text_hash"], limit=limit, after=after
        )
        items = [
            {
                "chunk_id": str(row.get("chunk_id") or row["id"]),
                "text_hash": str(row.get("text_hash") or ""),
            }
            for row in rows
        ]
        next_cursor = rows[-1]["id"] if rows and len(rows) == limit else None
        return {"items": items, "next": next_cursor}

    async def search(
        self,
        collection: str,
        queries: List[Dict[str, Optional[str]]],
        retrievers: List[str],
        audience: ChunkAudience,
        limit: int = 30,
        bm25_properties: Optional[List[str]] = None,
        status: Optional[str] = "active",
        facet_all: Optional[List[str]] = None,
        chunk_ids: Optional[List[str]] = None,
    ) -> List[Dict[str, Any]]:
        """
        One ranked hit list per (query, retriever), in query-major order.

        `audience` is REQUIRED for the reason KnowledgeChunkService.search gives: a
        forgotten filter over-shares rather than failing. Platform callers that may see
        everything say so with `ChunkAudience.unrestricted()`.

        Every filter — status, facets, audience, the chunk_ids scope — is a PRE-filter
        inside the Weaviate query; applied afterwards over a fixed top-k it would starve
        recall instead of narrowing it.

        Three cases answer with empty hits WITHOUT querying, each because widening
        would be the leak: an audience that can match nothing, an explicitly empty
        `chunk_ids` scope, and a collection that does not exist yet. Any Weaviate or
        embedding failure raises instead — empty must only ever mean "looked, found
        nothing".
        """
        validate_collection_name(collection)
        combos = [(qi, r) for qi in range(len(queries)) for r in retrievers]

        def empty() -> List[Dict[str, Any]]:
            return [{"query_index": qi, "retriever": r, "hits": []} for qi, r in combos]

        unknown = [r for r in retrievers if r not in RETRIEVERS]
        if unknown:
            raise ValueError(f"unknown retriever(s): {unknown}")

        any_of = audience.to_any_of()
        if any_of is not None and not any_of:
            return empty()
        if chunk_ids is not None and not chunk_ids:
            return empty()
        if not await self.vector_db.collection_exists(collection):
            return empty()

        vectors: List[List[float]] = []
        if any(r in VECTOR_RETRIEVERS for r in retrievers):
            vectors = await self._embed_queries(queries)

        filters: Dict[str, Any] = {}
        if status is not None:
            filters["status"] = status
        if chunk_ids is not None:
            filters["chunk_id"] = [_canonical_id(c) for c in chunk_ids]
        contains_all = {"facet_values": list(facet_all)} if facet_all else None
        common = {
            "collection_name": collection,
            "limit": limit,
            "filters": filters or None,
            "any_of": any_of,
            "contains_all": contains_all,
            "return_properties": _HIT_PROPERTIES,
        }

        calls = []
        for qi, retriever in combos:
            if retriever == BM25:
                calls.append(
                    self.vector_db.bm25_search(
                        query=queries[qi]["text"],
                        query_properties=bm25_properties or DEFAULT_BM25_PROPERTIES,
                        **common,
                    )
                )
            else:
                calls.append(
                    self.vector_db.named_vector_search(
                        vector=vectors[qi],
                        target_vector=VECTOR_RETRIEVERS[retriever],
                        **common,
                    )
                )

        # Concurrent; WeaviateDB's semaphore bounds how many reach Weaviate at once.
        # return_exceptions so every task is awaited before one failure is re-raised.
        outcomes = await asyncio.gather(*calls, return_exceptions=True)
        for outcome in outcomes:
            if isinstance(outcome, VectorDBSearchFailedException):
                raise outcome
            if isinstance(outcome, BaseException):
                logger.error(f"Context retrieval failed: {type(outcome).__name__}")
                raise VectorDBSearchFailedException("Context retrieval failed")

        results: List[Dict[str, Any]] = []
        for (qi, retriever), hits in zip(combos, outcomes):
            score_key = "score" if retriever == BM25 else "similarity"
            results.append(
                {
                    "query_index": qi,
                    "retriever": retriever,
                    "hits": [
                        {
                            "chunk_id": str(hit.get("chunk_id") or hit["id"]),
                            "rank": rank,
                            "score": float(hit.get(score_key) or 0.0),
                            "facet_values": list(hit.get("facet_values") or []),
                        }
                        for rank, hit in enumerate(hits, start=1)
                    ],
                }
            )
        return results

    async def _embed_queries(
        self, queries: List[Dict[str, Optional[str]]]
    ) -> List[List[float]]:
        """
        One vector per query, from `vector_text` when given (ally-be's contextualised
        rewrite) or the raw `text`. Embedded together in one call, each exactly once,
        however many vector retrievers then use it.
        """
        texts = [(q.get("vector_text") or q["text"]) for q in queries]
        try:
            vectors = await self.embedding_service.embed_many(texts)
        except EmbeddingFailedException:
            raise
        except Exception as e:
            logger.exception(f"Query embedding failed: {type(e).__name__}")
            raise EmbeddingFailedException("Failed to embed the queries")
        if len(vectors) != len(texts):
            raise EmbeddingFailedException("Embedding count mismatch for the queries")
        return vectors

    async def embed(self, texts: List[str]) -> Dict[str, Any]:
        """
        Raw embeddings with the index's own model, for ally-be's platitude and
        near-duplicate checks. Same model as the index on purpose: those checks compare
        against vectors here, and vectors from two models are not comparable at all.
        """
        if not texts or any(not (t or "").strip() for t in texts):
            raise ValueError("texts must be non-empty strings")
        try:
            vectors = await self.embedding_service.embed_many(list(texts))
        except EmbeddingFailedException:
            raise
        except Exception as e:
            logger.exception(f"Embedding failed: {type(e).__name__}")
            raise EmbeddingFailedException("Failed to embed the texts")
        if len(vectors) != len(texts):
            raise EmbeddingFailedException("Embedding count mismatch")
        return {"vectors": vectors, "model": EmbeddingConstants.MODEL}
