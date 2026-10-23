"""
Embeddings module for generating text embeddings.
"""

from app.core.embeddings.base import BaseEmbeddingClient
from app.core.embeddings.openai_embeddings import OpenAIEmbeddingClient

__all__ = [
    "BaseEmbeddingClient",
    "OpenAIEmbeddingClient",
]
