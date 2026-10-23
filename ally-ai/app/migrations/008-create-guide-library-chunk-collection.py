"""
Migration: create-guide-library-chunk-collection

Passage-level retrieval for the Ally guide's library — material on becoming and being
a helper that Ally grounds its answers in while it walks a learner through a course
(ally-be src/knowledge-base with corpus='ally_guide_library', src/guide/knowledge).
ally-be's Postgres (kb_documents + kb_document_chunks) is the system of record; this
collection is a derived index, exactly as KnowledgeChunk and CharacterChunk are.

Built from KnowledgeChunkProperties verbatim, for the reason migration 005 gives: a
passage is the same shape whatever it grounds, and the citation chain (Weaviate object
uuid == kb_document_chunks.id, char offsets into kb_documents.raw_text) is deliberately
not re-invented.

A SEPARATE COLLECTION, for the reasons migration 005 records — one similarity
distribution per chunk size, unfiltered ANN traversal over a corpus's own graph, and an
independent re-chunking lifecycle — plus one that is new with this corpus:

  * It is the first corpus that is NOT Ally-global throughout. It holds two kinds of
    document side by side: platform documents every learner may read, and one
    organisation's own protocols and handbooks, which only that organisation's
    learners may. A library shared with the WhatsApp corpus would put one
    organisation's internal escalation protocol one forgotten filter away from a
    health worker at another.

So the AUDIENCE pair (`is_global`, `tenant_ids`) is load-bearing here from the first
object written, rather than left at its closed defaults as on CharacterChunk. ally-be
writes it on every chunk (a platform document is `is_global = true`; an organisation's
is `tenant_ids = [that organisation]`), and every learner-facing search names who is
asking — the learner's organisation plus the global documents, or the global documents
alone for an anonymous visitor. Both properties are part of the shared list, so they are
created here; there is nothing to backfill on a collection that starts empty.

Same two explicit settings as 004/005: vectors always come from ally-ai's embedding
service (never Weaviate's own vectoriser, or the query side's model would not match),
and COSINE is pinned because every retrieval threshold is a cosine similarity.
"""

import weaviate.classes.config as wvc

from app.core.vector_db.constants import (
    KnowledgeChunkProperties,
    VectorDBCollectionNames,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def up(client):
    """
    Run the migration up.

    Args:
        client: Weaviate client instance
    """
    logger.info("Running migration up: create-guide-library-chunk-collection")

    collection_name = VectorDBCollectionNames.GUIDE_LIBRARY_CHUNKS

    try:
        collections = await client.collections.list_all()
        existing_collections = [
            col.name if hasattr(col, "name") else str(col) for col in collections
        ]

        if collection_name not in existing_collections:
            logger.info(f"Creating collection: {collection_name}")

            await client.collections.create(
                name=collection_name,
                properties=KnowledgeChunkProperties.get_all_properties(),
                vectorizer_config=wvc.Configure.Vectorizer.none(),
                vector_index_config=wvc.Configure.VectorIndex.hnsw(
                    distance_metric=wvc.VectorDistances.COSINE,
                ),
            )
            logger.info(f"Collection {collection_name} created successfully")
        else:
            logger.info(f"Collection {collection_name} already exists")

    except Exception as e:
        logger.error(
            f"Failed to create collection {collection_name}: {type(e).__name__}"
        )
        raise

    logger.info("Migration up completed: create-guide-library-chunk-collection")


async def down(client):
    """
    Run the migration down (rollback).

    Safe to run: the collection holds only derived data. Every chunk can be rebuilt from
    ally-be's Postgres via POST /api/v1/knowledge-base/documents/:id/reindex — but note
    that until it is, Ally's library tool returns nothing, for platform and organisation
    documents alike.

    Args:
        client: Weaviate client instance
    """
    logger.info("Running migration down: create-guide-library-chunk-collection")

    collection_name = VectorDBCollectionNames.GUIDE_LIBRARY_CHUNKS

    try:
        collections = await client.collections.list_all()
        existing_collections = [
            col.name if hasattr(col, "name") else str(col) for col in collections
        ]

        if collection_name in existing_collections:
            logger.info(f"Dropping collection: {collection_name}")
            await client.collections.delete(collection_name)
            logger.info(f"Collection {collection_name} dropped successfully")
        else:
            logger.info(f"Collection {collection_name} does not exist")

    except Exception as e:
        logger.error(f"Failed to drop collection {collection_name}: {type(e).__name__}")
        raise

    logger.info("Migration down completed: create-guide-library-chunk-collection")
