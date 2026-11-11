"""Names and schema of the Context Library's Weaviate collections.

ally-be's Postgres `cl_chunks` is the system of record; each collection here is a
DERIVED index of one Context Library collection, rebuilt from those rows whenever
needed. That is why the collections are created on demand by the first bulk-upsert that
targets a name, rather than by a migration: a rebuild writes a NEW versioned name
(`CtxFirstPrinciples_v2`), ally-be switches reads to it, and the old one is dropped —
blue/green, with no migration per version.

Because the name arrives as request data, it is the boundary that keeps these endpoints
away from every other collection in the cluster. `validate_collection_name` is applied
to every incoming name; nothing that fails it is ever passed to Weaviate.
"""

import re

import weaviate.classes.config as wvc

#: Every Context Library collection name, and nothing else. `Ctx` prefix + a PascalCase
#: library name + a version suffix. No existing collection (KnowledgeChunk,
#: ReferenceDocument, MigrationHistory, ...) can match, so a caller can neither read nor
#: drop one through these endpoints.
CONTEXT_COLLECTION_PATTERN = re.compile(r"^Ctx[A-Z][A-Za-z]+_v[0-9]+$")

#: The two named vectors. Both are self-provided (ally-ai embeds) and both are what a
#: vector retriever's `target_vector` may name.
STATEMENT_VECTOR = "statement"
SITUATIONS_VECTOR = "situations"
VECTOR_NAMES = (STATEMENT_VECTOR, SITUATIONS_VECTOR)

#: Properties BM25 may search — the word-tokenised text ones. FIELD-tokenised properties
#: are identifiers and facets, which keyword scoring over would only add noise to.
BM25_SEARCHABLE_PROPERTIES = frozenset(
    {"statement", "body", "situations", "example_queries", "keywords", "topics"}
)

#: The BM25 field weighting used when a caller does not choose one. A chunk's
#: statement and keywords say what it IS; its body only elaborates.
DEFAULT_BM25_PROPERTIES = [
    "statement^2",
    "keywords^2",
    "example_queries^1.5",
    "situations",
    "topics",
    "body",
]


class InvalidContextCollectionName(ValueError):
    """A collection name outside the Context Library's namespace."""


def validate_collection_name(name: str) -> str:
    """
    Return `name` unchanged if it is a Context Library collection name, else raise.

    `fullmatch`, not `match`: `$` in `re.match` also accepts a trailing newline, and a
    name that differs from the stored one by whitespace is exactly the kind of near-miss
    that must not reach Weaviate.
    """
    if not isinstance(name, str) or not CONTEXT_COLLECTION_PATTERN.fullmatch(name):
        raise InvalidContextCollectionName(
            "collection must match ^Ctx[A-Z][A-Za-z]+_v[0-9]+$"
        )
    return name


def _text(name: str, tokenization: wvc.Tokenization) -> wvc.Property:
    return wvc.Property(
        name=name,
        data_type=wvc.DataType.TEXT,
        tokenization=tokenization,
        skip_vectorization=True,
    )


def _text_array(name: str, tokenization: wvc.Tokenization) -> wvc.Property:
    return wvc.Property(
        name=name,
        data_type=wvc.DataType.TEXT_ARRAY,
        tokenization=tokenization,
        skip_vectorization=True,
    )


def collection_properties() -> list[wvc.Property]:
    """
    The property schema of every Context Library collection.

    Tokenisation is chosen per property and matters for correctness, not only ranking:
    identifiers, facets and audience fields are FIELD-tokenised so that equality and
    `contains_any`/`contains_all` filters match whole values — word tokenisation would
    let `domain:ux_ui` match a facet sharing one of its words. Text that BM25 searches
    is WORD-tokenised.
    """
    field, word = wvc.Tokenization.FIELD, wvc.Tokenization.WORD
    return [
        _text("chunk_id", field),
        _text("code", field),
        _text("collection_id", field),
        _text("status", field),
        _text("statement", word),
        _text("body", word),
        _text_array("situations", word),
        _text_array("example_queries", word),
        _text_array("keywords", word),
        _text_array("topics", word),
        _text_array("facet_values", field),
        wvc.Property(
            name="is_global", data_type=wvc.DataType.BOOL, skip_vectorization=True
        ),
        _text_array("tenant_ids", field),
        _text("owner_tenant_id", field),
        _text("text_hash", field),
    ]


def collection_create_kwargs() -> dict:
    """
    Arguments for `client.collections.create`, minus the name.

    Two NAMED vectors, both self-provided and both COSINE, for the same reasons
    migrations 004/005 pin them on KnowledgeChunk: the query side embeds with the same
    OpenAI model, so Weaviate must never vectorise these objects itself, and similarity
    only means something under a pinned metric.

    FLAT rather than HNSW indexes: a Context Library collection is small (hundreds to
    low thousands of chunks) and always searched with pre-filters. Flat is exact at that
    size, costs no graph memory, and does not lose recall under a selective filter the
    way a filtered HNSW traversal can.
    """
    index = wvc.Configure.VectorIndex.flat(distance_metric=wvc.VectorDistances.COSINE)
    return {
        "properties": collection_properties(),
        "vector_config": [
            wvc.Configure.Vectors.self_provided(name=name, vector_index_config=index)
            for name in VECTOR_NAMES
        ],
    }
