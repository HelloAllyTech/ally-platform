"""Constants for semantic similarity event detection."""

from typing import List

from pydantic import BaseModel

from app.core.config import settings

# OpenAI embedding model configuration
OPENAI_EMBEDDING_MODEL = settings.OPENAI_EMBEDDING_MODEL

# Similarity threshold for cosine similarity (0-1 range)
# Higher threshold means stricter matching
SEMANTIC_SIMILARITY_THRESHOLD = settings.SEMANTIC_SIMILARITY_THRESHOLD


class SemanticSimilarityData(BaseModel):
    """Data model for semantic similarity event configuration."""

    sentences: List[str]
    threshold: float = SEMANTIC_SIMILARITY_THRESHOLD

    class Config:
        frozen = True
