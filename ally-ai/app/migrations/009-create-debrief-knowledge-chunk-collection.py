"""
Migration: create-debrief-knowledge-chunk-collection

Passage-level retrieval for the Debrief agent's guidance lookup (v9 FR-16): practice
guidelines, the debrief style guide, level guides for lay and professional learners,
and organisations' own protocols (ally-be src/knowledge-base with
corpus='debrief_knowledge', read by src/debrief). ally-be's Postgres (kb_documents +
kb_document_chunks) is the system of record; this collection is a derived index,
exactly as KnowledgeChunk, CharacterChunk and GuideLibraryChunk are.

Built from KnowledgeChunkProperties verbatim, and a SEPARATE COLLECTION, for the
reasons migrations 005 and 008 record. Like the guide's library it holds platform
documents beside documents targeted at named organisations, so the AUDIENCE pair
(`is_global`, `tenant_ids`) is written on every chunk and every search names who is
asking. Which clinical documents may be served (signed off by the clinical advisor)
is decided in ally-be's Postgres before any search, never here.

COSINE is pinned and vectors always come from ally-ai's embedding service, as in
004/005/008.
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
    logger.info("Running migration up: create-debrief-knowledge-chunk-collection")

    collection_name = VectorDBCollectionNames.DEBRIEF_KNOWLEDGE_CHUNKS

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

    logger.info("Migration up completed: create-debrief-knowledge-chunk-collection")


async def down(client):
    """
    Run the migration down (rollback).

    Safe to run: the collection holds only derived data. Every chunk can be rebuilt from
    ally-be's Postgres via POST /api/v1/knowledge-base/documents/:id/reindex — but note
    that until it is, the Debrief agent's guidance lookup finds nothing, which never
    stops a debrief.

    Args:
        client: Weaviate client instance
    """
    logger.info("Running migration down: create-debrief-knowledge-chunk-collection")

    collection_name = VectorDBCollectionNames.DEBRIEF_KNOWLEDGE_CHUNKS

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

    logger.info("Migration down completed: create-debrief-knowledge-chunk-collection")
