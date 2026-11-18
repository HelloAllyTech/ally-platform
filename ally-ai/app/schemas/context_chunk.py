"""Request/response shapes for the Context Library index (/context-chunks).

ally-be owns `cl_chunks` in Postgres and pushes chunks here; the Weaviate object UUID is
the chunk id, so every write is an idempotent upsert. The target collection travels as a
`collection` query parameter, validated in the endpoint module, not in these bodies.
"""

import re
from typing import Annotated, List, Literal, Optional

from pydantic import AfterValidator, BaseModel, Field, field_validator

from app.core.context_library.collection_schema import BM25_SEARCHABLE_PROPERTIES
from app.core.knowledge_base.knowledge_chunk_service import ChunkAudience


def _not_blank(value: str) -> str:
    """Reject whitespace-only text without altering what the caller sent."""
    if not value.strip():
        raise ValueError("must not be empty or whitespace")
    return value


NonBlankStr = Annotated[str, AfterValidator(_not_blank)]

_BM25_PROPERTY = re.compile(r"^([a-z_]+)(\^[0-9]+(\.[0-9]+)?)?$")

Retriever = Literal["bm25", "statement", "situations"]


# ---- bulk upsert ----


class ContextChunkProperties(BaseModel):
    """The stored, non-vectorised properties of one chunk — a projection of its
    cl_chunks row."""

    code: str
    collection_id: str
    status: str
    statement: str
    body: Optional[str] = None
    situations: List[str] = Field(default_factory=list)
    example_queries: List[str] = Field(default_factory=list)
    keywords: List[str] = Field(default_factory=list)
    topics: List[str] = Field(default_factory=list)
    facet_values: List[str] = Field(
        default_factory=list, description='Facet strings such as "domain:ux_ui"'
    )
    is_global: bool = Field(
        False,
        description=(
            "Available to every organisation. Defaults to the CLOSED value: a chunk "
            "nobody retrieves is a visible bug, one everybody retrieves an invisible "
            "leak"
        ),
    )
    tenant_ids: List[str] = Field(default_factory=list)
    owner_tenant_id: Optional[str] = None
    text_hash: str = Field(
        ..., description="ally-be's hash of the embedded text; echoed by /ids"
    )


class ContextChunkUpsertItem(BaseModel):
    chunk_id: str = Field(
        ...,
        description=(
            "cl_chunks id; becomes the object UUID. A plain string, so a malformed id "
            "is reported in `failed` rather than 422-ing the whole batch"
        ),
    )
    statement_text: str = Field(
        ...,
        description=(
            "Text embedded into the `statement` vector. Empty fails this item only"
        ),
    )
    situations_text: str = Field(
        "",
        description=(
            "Text embedded into the `situations` vector. Empty indexes the chunk "
            "without that vector"
        ),
    )
    properties: ContextChunkProperties


class ContextChunkBulkUpsertRequest(BaseModel):
    items: List[ContextChunkUpsertItem] = Field(..., min_length=1, max_length=100)


class ContextChunkFailure(BaseModel):
    chunk_id: str
    error: str


class ContextChunkBulkUpsertResponse(BaseModel):
    """
    Per-chunk outcomes. ally-be retries only `failed`, so a partly failed batch is a
    200 with detail, never an error status that would make it resend what landed.
    """

    succeeded: List[str] = Field(default_factory=list)
    failed: List[ContextChunkFailure] = Field(default_factory=list)


# ---- delete / ids / collection ----


class ContextChunkDeleteRequest(BaseModel):
    chunk_ids: List[str] = Field(
        ...,
        min_length=1,
        max_length=10_000,
        description=(
            "Upper bound is Weaviate's default batch-delete ceiling: above it a delete "
            "would quietly remove only part of what was asked"
        ),
    )


class ContextChunkDeleteResponse(BaseModel):
    deleted: int = Field(..., description="Chunks removed. 0 is legitimate")


class ContextChunkIdItem(BaseModel):
    chunk_id: str
    text_hash: str


class ContextChunkIdsResponse(BaseModel):
    items: List[ContextChunkIdItem] = Field(default_factory=list)
    next: Optional[str] = Field(
        None, description="Pass as `after` for the next page; null on the last page"
    )


class ContextCollectionDeleteResponse(BaseModel):
    deleted: bool


# ---- search ----


class ContextSearchQuery(BaseModel):
    text: NonBlankStr = Field(
        ...,
        description="Searched by BM25; also embedded when `vector_text` is null",
    )
    vector_text: Optional[NonBlankStr] = Field(
        None,
        description=(
            "Embedded for the vector retrievers instead of `text`. Lets ally-be "
            "contextualise the vector side without diluting the keyword side"
        ),
    )


class ContextAudienceSelector(BaseModel):
    """Who the retrieval is for. Maps onto `ChunkAudience`."""

    tenant_id: Optional[str] = None
    include_global: bool = True

    def to_chunk_audience(self) -> ChunkAudience:
        return ChunkAudience(
            tenant_id=self.tenant_id or None, include_global=self.include_global
        )


class ContextChunkSearchRequest(BaseModel):
    queries: List[ContextSearchQuery] = Field(..., min_length=1, max_length=6)
    retrievers: List[Retriever] = Field(..., min_length=1, max_length=3)
    limit: int = Field(30, ge=1, le=100, description="Hits per query × retriever")
    bm25_properties: Optional[List[str]] = Field(
        None,
        min_length=1,
        description=(
            "BM25 fields with optional ^boost, e.g. 'statement^2'. Null uses the "
            "default weighting"
        ),
    )
    status: Optional[Literal["active"]] = Field(
        "active", description="Equality filter on status; null disables it"
    )
    facet_all: Optional[List[str]] = Field(
        None, description="Hard filter: a chunk must carry ALL of these facet values"
    )
    chunk_ids: Optional[List[str]] = Field(
        None,
        description=(
            "Restrict to these chunks. An EMPTY list returns empty results — never an "
            "unfiltered search"
        ),
    )
    audience: Optional[ContextAudienceSelector] = Field(
        None,
        description=(
            "Null means unrestricted (platform callers). Otherwise global chunks "
            "and/or the tenant's; an audience matching nothing returns empty results"
        ),
    )

    @field_validator("retrievers")
    @classmethod
    def reject_duplicate_retrievers(cls, value: List[str]) -> List[str]:
        """A repeated retriever would return the same ranked list twice, which a rank
        fuser would count as two votes."""
        if len(set(value)) != len(value):
            raise ValueError("retrievers must not repeat")
        return value

    @field_validator("bm25_properties")
    @classmethod
    def check_bm25_properties(cls, value: Optional[List[str]]) -> Optional[List[str]]:
        """
        Refused here rather than passed through: an unknown property makes Weaviate
        fail the query, which would reach ally-be as a 503 — "retrieval is down" — for
        what is really a caller bug.
        """
        if value is None:
            return value
        for entry in value:
            match = _BM25_PROPERTY.fullmatch(entry)
            if not match or match.group(1) not in BM25_SEARCHABLE_PROPERTIES:
                raise ValueError(
                    f"'{entry}' is not a searchable property; use one of "
                    f"{sorted(BM25_SEARCHABLE_PROPERTIES)} with an optional ^boost"
                )
        return value

    def to_chunk_audience(self) -> ChunkAudience:
        """Null audience is the explicit unrestricted case, stated once here."""
        if self.audience is None:
            return ChunkAudience.unrestricted()
        return self.audience.to_chunk_audience()


class ContextSearchHit(BaseModel):
    chunk_id: str
    rank: int = Field(..., ge=1, description="1-based position in this list")
    score: float = Field(
        ..., description="BM25 score, or cosine similarity (1 - distance) for vectors"
    )
    facet_values: List[str] = Field(default_factory=list)


class ContextSearchResult(BaseModel):
    query_index: int
    retriever: Retriever
    hits: List[ContextSearchHit] = Field(default_factory=list)


class ContextChunkSearchResponse(BaseModel):
    results: List[ContextSearchResult] = Field(default_factory=list)


# ---- embed ----


class ContextEmbedRequest(BaseModel):
    texts: List[NonBlankStr] = Field(..., min_length=1, max_length=100)


class ContextEmbedResponse(BaseModel):
    vectors: List[List[float]]
    model: str
