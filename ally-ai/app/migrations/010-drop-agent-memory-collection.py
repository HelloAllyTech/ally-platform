"""
Migration: drop-agent-memory-collection

Retires the `AgentMemory` collection (migration 007). Bug Hunter's notes and
Builder's lessons moved into ally-be's Context Library (phase 5): their rows were
copied from ally-be's Postgres, the system of record, into the Bug Hunter Notes and
Builder Lessons collections, whose own derived indexes are the
`Ctx<Collection>_v{N}` collections behind /context-chunks. Nothing reads or writes
`AgentMemory` any more: the /agent-memories endpoints and their service are deleted
in the same change.

The collection held vectors and no text, derived entirely from Postgres rows, so
dropping it loses nothing and needs no confirmation step. Migration 007 is
immutable and stays as it is.

`down` recreates the collection empty, configured exactly as 007 made it; nothing
will fill it.
"""

import weaviate.classes.config as wvc

from app.core.vector_db.constants import (
    AgentMemoryProperties,
    VectorDBCollectionNames,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)


async def _existing_names(client):
    collections = await client.collections.list_all()
    return [col.name if hasattr(col, "name") else str(col) for col in collections]


async def up(client):
    """
    Run the migration up: drop the retired AgentMemory collection if it exists.

    Args:
        client: Weaviate client instance
    """
    logger.info("Running migration up: drop-agent-memory-collection")

    collection_name = VectorDBCollectionNames.AGENT_MEMORIES

    try:
        if collection_name in await _existing_names(client):
            logger.info(f"Dropping retired collection: {collection_name}")
            await client.collections.delete(collection_name)
            logger.info(f"Collection {collection_name} dropped successfully")
        else:
            logger.info(f"Collection {collection_name} does not exist")
    except Exception as e:
        logger.error(f"Failed to drop collection {collection_name}: {type(e).__name__}")
        raise

    logger.info("Migration up completed: drop-agent-memory-collection")


async def down(client):
    """
    Run the migration down: recreate the AgentMemory collection empty, as 007 made it.

    Args:
        client: Weaviate client instance
    """
    logger.info("Running migration down: drop-agent-memory-collection")

    collection_name = VectorDBCollectionNames.AGENT_MEMORIES

    try:
        if collection_name not in await _existing_names(client):
            await client.collections.create(
                name=collection_name,
                properties=AgentMemoryProperties.get_all_properties(),
                vectorizer_config=wvc.Configure.Vectorizer.none(),
                vector_index_config=wvc.Configure.VectorIndex.hnsw(
                    distance_metric=wvc.VectorDistances.COSINE,
                ),
            )
            logger.info(f"Collection {collection_name} recreated (empty)")
        else:
            logger.info(f"Collection {collection_name} already exists")
    except Exception as e:
        logger.error(
            f"Failed to recreate collection {collection_name}: {type(e).__name__}"
        )
        raise

    logger.info("Migration down completed: drop-agent-memory-collection")
