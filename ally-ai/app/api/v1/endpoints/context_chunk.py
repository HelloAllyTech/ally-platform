"""Context Library index endpoints — write, reconcile and retrieve.

ally-be's `cl_chunks` table is the system of record; each Context Library collection in
Weaviate is a derived index of it, created on demand by its first bulk-upsert. Every
route except /embed names its collection in a `collection` query parameter, which must
match `^Ctx[A-Z][A-Za-z]+_v[0-9]+$` or the request is refused with 400 before anything
reaches Weaviate. That pattern is the boundary keeping these routes away from every
other collection in the cluster.

Retrieval here is raw — one ranked list per (query, retriever). Fusion, thresholds and
deciding what the hits mean live in ally-be.
"""

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, status

from app.core.context_library.collection_schema import (
    InvalidContextCollectionName,
    validate_collection_name,
)
from app.core.context_library.context_chunk_service import (
    ConfirmationMismatch,
    ContextChunkService,
)
from app.core.dependencies import get_context_chunk_service
from app.exceptions.custom_exceptions import (
    EmbeddingFailedException,
    VectorDBDeleteFailedException,
    VectorDBInsertFailedException,
    VectorDBSearchFailedException,
)
from app.schemas.context_chunk import (
    ContextChunkBulkUpsertRequest,
    ContextChunkBulkUpsertResponse,
    ContextChunkDeleteRequest,
    ContextChunkDeleteResponse,
    ContextChunkIdsResponse,
    ContextChunkSearchRequest,
    ContextChunkSearchResponse,
    ContextCollectionDeleteResponse,
    ContextEmbedRequest,
    ContextEmbedResponse,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)
router = APIRouter()

TAGS = ["context_chunks"]

#: Said on every retrieval failure, so ally-be reports "could not look" rather than
#: "the library holds nothing on this".
RETRIEVAL_FAILED = "Context retrieval failed; the result says nothing about the library"


def context_collection(
    collection: str = Query(
        ..., description="Context Library collection, e.g. CtxFirstPrinciples_v1"
    ),
) -> str:
    """
    The validated collection name. 400 rather than FastAPI's 422, because a name
    outside the namespace is a refused request, not a malformed one.
    """
    try:
        return validate_collection_name(collection)
    except InvalidContextCollectionName as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


def _unavailable(error: Exception) -> HTTPException:
    """503 carrying the exception's own message, without the custom exceptions'
    "ClassName: ... (Status Code: 500)" decoration, which would contradict the 503."""
    detail = str(error.args[0]) if error.args else "The vector index is unavailable"
    return HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=detail)


def _internal_error(what: str) -> HTTPException:
    return HTTPException(
        status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=f"{what} failed"
    )


@router.post(
    "/bulk-upsert",
    response_model=ContextChunkBulkUpsertResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def bulk_upsert_context_chunks(
    payload: ContextChunkBulkUpsertRequest,
    collection: str = Depends(context_collection),
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    Embed and insert-or-replace up to 100 chunks, creating the collection on its first
    write.

    200 with per-chunk `succeeded`/`failed` whatever happens to individual items;
    503 only when Weaviate cannot be reached at all, so ally-be retries just the failed
    items in the first case and the whole batch in the second.
    """
    try:
        result = await service.bulk_upsert(
            collection, [item.model_dump() for item in payload.items]
        )
        return ContextChunkBulkUpsertResponse(**result)
    except (VectorDBInsertFailedException, VectorDBSearchFailedException) as e:
        raise _unavailable(e)
    except Exception:
        logger.exception("Unexpected error in context chunk bulk upsert")
        raise _internal_error("Bulk upsert")


@router.post(
    "/delete",
    response_model=ContextChunkDeleteResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def delete_context_chunks(
    payload: ContextChunkDeleteRequest,
    collection: str = Depends(context_collection),
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    Remove chunks by id. Always 200 on success, including `deleted: 0` — "make sure
    these are gone" is satisfied whether or not they existed. A failure is surfaced as
    503 so ally-be does not record vectors as removed while they are still retrievable.
    """
    try:
        deleted = await service.delete(collection, payload.chunk_ids)
        return ContextChunkDeleteResponse(deleted=deleted)
    except (VectorDBDeleteFailedException, VectorDBSearchFailedException) as e:
        raise _unavailable(e)
    except Exception:
        logger.exception("Unexpected error deleting context chunks")
        raise _internal_error("Delete")


@router.get(
    "/ids",
    response_model=ContextChunkIdsResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def list_context_chunk_ids(
    collection: str = Depends(context_collection),
    after: Optional[UUID] = Query(
        None, description="Cursor: the `next` value of the previous page"
    ),
    limit: int = Query(200, ge=1, le=500),
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    One page of ``{chunk_id, text_hash}`` for reconciliation. A collection that does
    not exist yet is an empty page, not an error.

    `after` is typed as a UUID so a malformed cursor is a 422 here instead of a Weaviate
    error that would read as an outage.
    """
    try:
        page = await service.list_ids(
            collection, limit=limit, after=str(after) if after else None
        )
        return ContextChunkIdsResponse(**page)
    except VectorDBSearchFailedException as e:
        raise _unavailable(e)
    except Exception:
        logger.exception("Unexpected error listing context chunk ids")
        raise _internal_error("Listing ids")


@router.post(
    "/search",
    response_model=ContextChunkSearchResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def search_context_chunks(
    payload: ContextChunkSearchRequest,
    collection: str = Depends(context_collection),
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    One ranked hit list per query × retriever, all filters applied inside the query.

    Every failure to look — Weaviate unreachable, the query embedding failing — is a
    503 carrying RETRIEVAL_FAILED, never an empty 200: empty hits must only ever mean
    the index was searched and nothing matched.
    """
    try:
        results = await service.search(
            collection,
            queries=[q.model_dump() for q in payload.queries],
            retrievers=list(payload.retrievers),
            audience=payload.to_chunk_audience(),
            limit=payload.limit,
            bm25_properties=payload.bm25_properties,
            status=payload.status,
            facet_all=payload.facet_all,
            chunk_ids=payload.chunk_ids,
        )
        return ContextChunkSearchResponse(results=results)
    except (VectorDBSearchFailedException, EmbeddingFailedException) as e:
        logger.error(f"Context search failed: {type(e).__name__}")
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail=RETRIEVAL_FAILED
        )
    except Exception:
        logger.exception("Unexpected error searching context chunks")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=RETRIEVAL_FAILED
        )


@router.post(
    "/embed",
    response_model=ContextEmbedResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def embed_texts(
    payload: ContextEmbedRequest,
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    Embed texts with the index's own model, for ally-be's platitude and duplicate
    checks. 502 when the embedding provider fails, as /knowledge-chunks/search does.
    """
    try:
        result = await service.embed(list(payload.texts))
        return ContextEmbedResponse(**result)
    except EmbeddingFailedException:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY, detail="Failed to embed the texts"
        )
    except Exception:
        logger.exception("Unexpected error embedding texts")
        raise _internal_error("Embedding")


@router.delete(
    "/collection",
    response_model=ContextCollectionDeleteResponse,
    status_code=status.HTTP_200_OK,
    tags=TAGS,
)
async def delete_context_collection(
    collection: str = Depends(context_collection),
    confirm: Optional[str] = Query(
        None, description="Must repeat `collection` exactly, or the request is refused"
    ),
    service: ContextChunkService = Depends(get_context_chunk_service),
):
    """
    Drop a whole collection — blue/green cleanup once ally-be serves from a newer
    version. Refused with 400 unless `confirm` repeats the name exactly; a missing
    collection answers `deleted: false`.
    """
    try:
        deleted = await service.delete_collection(collection, confirm)
        return ContextCollectionDeleteResponse(deleted=deleted)
    except ConfirmationMismatch as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    except (VectorDBDeleteFailedException, VectorDBSearchFailedException) as e:
        raise _unavailable(e)
    except Exception:
        logger.exception("Unexpected error deleting a context collection")
        raise _internal_error("Collection delete")
