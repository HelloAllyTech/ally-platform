"""
OpenAI embedding client implementation using langchain-openai.

Usage: a call made with ``task=`` is recorded to ``llm_usage`` (input tokens
only — embeddings bill nothing else). LangChain's ``OpenAIEmbeddings`` does
not surface the response's ``usage``, so the tokens are counted with the same
tiktoken encoding LangChain itself tokenizes the input with before sending
(``check_embedding_ctx_length`` defaults on), which is what OpenAI bills. The
encoding is already loaded by that call, so the count costs microseconds.
"""

from typing import Any, List, Optional

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
        room_id: LiveKit room this client serves, for attributing usage. The
            worker builds one client per session; callers may override per call.
    """

    def __init__(
        self,
        model: Optional[str] = None,
        api_key: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> None:
        self._model = model or settings.OPENAI_EMBEDDING_MODEL
        self._api_key = api_key or settings.OPENAI_API_KEY
        self._room_id = room_id
        self._encoding: Any = None
        self._embeddings = OpenAIEmbeddings(model=self._model, api_key=self._api_key)
        logger.debug(f"Initialized OpenAIEmbeddingClient with model: {self._model}")

    async def get_embedding(
        self,
        text: str,
        *,
        task: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> np.ndarray:
        """
        Get embedding for a single text using OpenAI API.

        Args:
            text: Text to embed
            task: LLMTask label to record the call's usage under; None records
                nothing.
            room_id: Room to attribute it to (defaults to the client's room,
                then the graph run's).

        Returns:
            Numpy array of embedding values
        """
        try:
            embedding = await self._embeddings.aembed_query(text)
        except Exception as e:
            logger.exception(f"Failed to get embedding for text: {e}")
            raise
        self._record_usage([text], task, room_id)
        return np.array(embedding, dtype=np.float32)

    async def get_embeddings_batch(
        self,
        texts: List[str],
        *,
        task: Optional[str] = None,
        room_id: Optional[str] = None,
    ) -> List[np.ndarray]:
        """
        Get embeddings for multiple texts in a single API call.

        Args:
            texts: List of texts to embed
            task: LLMTask label to record the call's usage under; None records
                nothing.
            room_id: Room to attribute it to (defaults to the client's room,
                then the graph run's).

        Returns:
            List of numpy arrays containing embeddings
        """
        try:
            embeddings = await self._embeddings.aembed_documents(texts)
        except Exception as e:
            logger.exception(f"Failed to get batch embeddings: {e}")
            raise
        self._record_usage(texts, task, room_id)
        return [np.array(emb, dtype=np.float32) for emb in embeddings]

    def _count_input_tokens(self, texts: List[str]) -> int:
        """Input tokens as OpenAI counts them for this model."""
        if self._encoding is None:
            import tiktoken

            try:
                self._encoding = tiktoken.encoding_for_model(self._model)
            except KeyError:
                self._encoding = tiktoken.get_encoding("cl100k_base")
        return sum(len(self._encoding.encode_ordinary(t)) for t in texts if t)

    def _record_usage(
        self, texts: List[str], task: Optional[str], room_id: Optional[str]
    ) -> None:
        """Best-effort usage emission for a call that succeeded. Never raises."""
        if not task:
            return
        try:
            from app.core.llm_usage.emitter import emit_embedding_usage

            emit_embedding_usage(
                task=task,
                model=self._model,
                input_tokens=self._count_input_tokens(texts),
                room_id=room_id or self._room_id,
            )
        except Exception:  # noqa: BLE001 - usage must never break an embedding
            logger.debug("embedding usage skipped (best-effort)", exc_info=True)
