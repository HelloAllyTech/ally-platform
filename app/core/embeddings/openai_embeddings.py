"""
OpenAI embedding client implementation using langchain-openai.
"""

from typing import List, Optional

import numpy as np
from langchain_openai import OpenAIEmbeddings

from app.core.config import settings
from app.core.embeddings.base import BaseEmbeddingClient
from app.core.logger import get_logger

logger = get_logger(__name__)


class OpenAIEmbeddingClient(BaseEmbeddingClient):
    """
    OpenAI embedding client using langchain-openai.

    Uses OpenAI's text-embedding models via LangChain's OpenAIEmbeddings.

    Args:
        model: OpenAI embedding model to use
        api_key: OpenAI API key (defaults to settings.OPENAI_API_KEY)
    """

    def __init__(
        self, model: Optional[str] = None, api_key: Optional[str] = None
    ) -> None:
        self._model = model or settings.OPENAI_EMBEDDING_MODEL
        self._api_key = api_key or settings.OPENAI_API_KEY
        self._embeddings = OpenAIEmbeddings(model=self._model, api_key=self._api_key)
        logger.debug(f"Initialized OpenAIEmbeddingClient with model: {self._model}")

    async def get_embedding(self, text: str) -> np.ndarray:
        """
        Get embedding for a single text using OpenAI API.

        Args:
            text: Text to embed

        Returns:
            Numpy array of embedding values
        """
        try:
            embedding = await self._embeddings.aembed_query(text)
            return np.array(embedding, dtype=np.float32)
        except Exception as e:
            logger.exception(f"Failed to get embedding for text: {e}")
            raise

    async def get_embeddings_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        Get embeddings for multiple texts in a single API call.

        Args:
            texts: List of texts to embed

        Returns:
            List of numpy arrays containing embeddings
        """
        try:
            embeddings = await self._embeddings.aembed_documents(texts)
            return [np.array(emb, dtype=np.float32) for emb in embeddings]
        except Exception as e:
            logger.exception(f"Failed to get batch embeddings: {e}")
            raise
