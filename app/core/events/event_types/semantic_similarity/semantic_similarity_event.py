"""
Semantic similarity event using OpenAI embeddings for matching.
Uses cosine similarity between embeddings instead of token-based matching.
"""

from dataclasses import dataclass
from typing import ClassVar, Dict, List, Optional, Tuple

import numpy as np
from pydantic import PrivateAttr
from typing_extensions import override

from app.core.config import settings
from app.core.embeddings import BaseEmbeddingClient
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.semantic_similarity.constants import (
    SEMANTIC_SIMILARITY_THRESHOLD,
)
from app.core.llm_usage.tasks import LLMTask
from app.core.logger import get_logger

logger = get_logger(__name__)


@dataclass(frozen=True)
class EmbeddedPattern:
    """Represents a sentence with its precomputed embedding."""

    original: str
    embedding: np.ndarray


class SemanticSimilarityEvent(BaseEvent):
    """
    Semantic similarity event that uses OpenAI embeddings for matching.

    Compares input sentences with target sentences using cosine similarity
    of their embeddings from OpenAI's text-embedding-3-small model.
    """

    # Regular fields that survive serialization
    sentences: List[str] = []
    similarity_threshold: float = SEMANTIC_SIMILARITY_THRESHOLD

    # Private attributes for transient/computed state
    _instance_patterns: List[EmbeddedPattern] = PrivateAttr(default_factory=list)
    _instance_built: bool = PrivateAttr(default=False)

    # Shared cache across instances: (sentences_hash, threshold) -> patterns
    # Uses FIFO eviction when cache exceeds max size to prevent memory issues
    _PATTERN_CACHE: ClassVar[Dict[Tuple[int, float], List[EmbeddedPattern]]] = {}
    _PATTERN_CACHE_MAX_SIZE: ClassVar[int] = 100

    # Input embedding cache: text -> embedding (prevents duplicate API calls)
    # Uses FIFO eviction when cache exceeds max size to prevent memory issues
    _INPUT_EMBEDDING_CACHE: ClassVar[Dict[str, np.ndarray]] = {}
    _INPUT_CACHE_MAX_SIZE: ClassVar[int] = 1000  # Limit cache size

    # Class-level embedding client registry
    # Why: LangGraph's MemorySaver checkpointer serializes state between
    # nodes using Pydantic's model_dump() and recreates instances with
    # model_construct().
    # This causes private attributes (_embedding_client) to be lost during
    # deserialization.
    # The class-level storage survives serialization since it's not
    # instance-specific.
    # This is acceptable because each worker process handles one scenario at
    # a time, and all SemanticSimilarityEvents in that scenario share the
    # same embedding model.
    _EMBEDDING_CLIENT: ClassVar[Optional[BaseEmbeddingClient]] = None

    # Note: No model_post_init needed - we use class-level _EMBEDDING_CLIENT directly

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        custom_sentences: List[str],
        similarity_threshold: Optional[float] = SEMANTIC_SIMILARITY_THRESHOLD,
        embedding_client: Optional[BaseEmbeddingClient] = None,
        **kwargs,
    ) -> "SemanticSimilarityEvent":
        """
        Create a SemanticSimilarityEvent with Pydantic-safe construction.

        Args:
            event_id: Unique event identifier
            custom_sentences: List of target sentences to match against
            similarity_threshold: Cosine similarity threshold (0-1),
                default 0.75
            embedding_client: Optional embedding client (for tests only;
                production uses class-level client)
            **kwargs: Additional BaseEvent fields (score, emoji, visibility_type, etc.)

        Note:
            In production, the embedding client is initialized once at the
            worker/session level and stored in cls._EMBEDDING_CLIENT.
            The embedding_client parameter is only used in tests to inject
            a mock client.
        """
        # Allow tests to inject embedding client, but production uses class-level one
        if cls._EMBEDDING_CLIENT is None and embedding_client is not None:
            cls._EMBEDDING_CLIENT = embedding_client

        inst: SemanticSimilarityEvent = cls.model_construct(
            event_id=event_id,
            sentences=list(custom_sentences or []),
            similarity_threshold=(
                similarity_threshold
                if similarity_threshold is not None
                else SEMANTIC_SIMILARITY_THRESHOLD
            ),
            **kwargs,
        )
        inst._instance_patterns = []
        inst._instance_built = False
        return inst

    # ---------- Detection ----------
    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detect the event in the given conversation (final utterance by counselor).

        Uses semantic similarity via embeddings rather than token-based matching.
        """
        if not conversations:
            return False

        last = conversations[-1]
        if last.role.lower() != "counselor":
            return False

        return await self._match_semantic(last.content)

    async def _match_semantic(self, sentence: str) -> bool:
        """
        Check if sentence semantically matches any target pattern using embeddings.

        Args:
            sentence: Input sentence to check

        Returns:
            True if cosine similarity with any pattern exceeds threshold
        """
        await self._ensure_patterns_built()

        if not sentence.strip():
            return False

        if not self._instance_patterns:
            return False

        # Get embedding for the input sentence
        # (with caching to avoid duplicate API calls if optimizations enabled)
        try:
            if settings.ENABLE_EVENT_DETECTION_OPTIMIZATIONS:
                input_embedding = await self._get_embedding_cached(sentence)
            else:
                # Old behavior: no cache
                input_embedding = await self._get_embedding(sentence)
        except Exception as e:
            logger.exception(f"Failed to get embedding for input sentence: {e}")
            return False

        # Calculate cosine similarity with all target patterns
        for pattern in self._instance_patterns:
            similarity = self._cosine_similarity(input_embedding, pattern.embedding)

            if similarity >= self.similarity_threshold:
                logger.info(
                    f"Semantic match found: '{sentence}' ~ "
                    f"'{pattern.original}' (similarity: {similarity:.3f}, "
                    f"threshold: {self.similarity_threshold})"
                )
                return True

        return False

    # ---------- Build & Helpers ----------
    async def _ensure_patterns_built(self) -> None:
        """Build embeddings for all target sentences (with caching)."""
        if self._instance_built:
            return

        # Empty sentences list is permitted (event will never match)
        if not self.sentences:
            self._instance_patterns = []
            self._instance_built = True
            return

        # Deduplicate and strip surrounding quotes/whitespace
        deduped: List[str] = []
        seen: set[str] = set()
        for s in self.sentences:
            cleaned = s.strip().strip("\"'")
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                deduped.append(cleaned)

        # Cache key from normalized phrases and threshold
        sentences_key = hash(tuple(deduped))
        cache_key = (sentences_key, float(self.similarity_threshold))

        cached = self._PATTERN_CACHE.get(cache_key)
        if cached is not None:
            self._instance_patterns = cached
            self._instance_built = True
            logger.debug(f"Using cached embeddings for {len(cached)} patterns")
            return

        # Build embeddings for all target sentences
        patterns: List[EmbeddedPattern] = []
        logger.info(f"Building embeddings for {len(deduped)} target sentences")

        try:
            # Batch embedding requests for efficiency
            embeddings = await self._get_embeddings_batch(deduped)

            for sentence, embedding in zip(deduped, embeddings):
                patterns.append(EmbeddedPattern(original=sentence, embedding=embedding))

            # Add to cache with size limit using FIFO eviction
            if len(self._PATTERN_CACHE) >= self._PATTERN_CACHE_MAX_SIZE:
                oldest_key = next(iter(self._PATTERN_CACHE))
                del self._PATTERN_CACHE[oldest_key]
                logger.debug(
                    f"Evicted oldest pattern cache entry "
                    f"(size limit: {self._PATTERN_CACHE_MAX_SIZE})"
                )

            self._PATTERN_CACHE[cache_key] = patterns
            self._instance_patterns = patterns
            self._instance_built = True
            logger.info(f"Successfully built {len(patterns)} semantic patterns")

        except Exception as e:
            logger.exception(f"Failed to build embeddings: {e}")
            self._instance_patterns = []
            self._instance_built = True

    async def _get_embedding(self, text: str) -> np.ndarray:
        """
        Get embedding for a single text using the embedding client.

        Args:
            text: Text to embed

        Returns:
            Numpy array of embedding values
        """
        if self._EMBEDDING_CLIENT is None:
            raise RuntimeError(
                f"SemanticSimilarityEvent '{self.event_id}' has no "
                f"embedding client. Ensure the event is created using the "
                f".create() class method with an embedding_client."
            )
        # Recorded as event_embedding; the room is the client's own (one
        # client per session), falling back to the graph run's.
        return await self._EMBEDDING_CLIENT.get_embedding(
            text, task=LLMTask.EVENT_EMBEDDING.value
        )

    async def _get_embedding_cached(self, text: str) -> np.ndarray:
        """
        Get embedding for text with caching to avoid duplicate API calls.

        This optimization prevents multiple semantic similarity events from making
        duplicate API calls when checking the same input text. Uses FIFO eviction
        when cache exceeds max size to prevent memory issues.

        Args:
            text: Text to embed

        Returns:
            Numpy array of embedding values
        """
        # Check cache first
        if text in self._INPUT_EMBEDDING_CACHE:
            logger.debug(f"Using cached embedding for text: '{text[:50]}...'")
            return self._INPUT_EMBEDDING_CACHE[text]

        # Get embedding from API
        embedding = await self._get_embedding(text)

        # Add to cache (with size limit using FIFO eviction)
        if len(self._INPUT_EMBEDDING_CACHE) >= self._INPUT_CACHE_MAX_SIZE:
            # Remove oldest entry (FIFO eviction)
            # Note: For true LRU, would need OrderedDict,
            # but FIFO is simpler and sufficient
            oldest_key = next(iter(self._INPUT_EMBEDDING_CACHE))
            del self._INPUT_EMBEDDING_CACHE[oldest_key]
            logger.debug(
                f"Evicted oldest embedding from cache "
                f"(size limit: {self._INPUT_CACHE_MAX_SIZE})"
            )

        self._INPUT_EMBEDDING_CACHE[text] = embedding
        cache_size = len(self._INPUT_EMBEDDING_CACHE)
        logger.debug(
            f"Cached embedding for text: '{text[:50]}...' "
            f"(cache size: {cache_size})"
        )

        return embedding

    async def _get_embeddings_batch(self, texts: List[str]) -> List[np.ndarray]:
        """
        Get embeddings for multiple texts in a batch.

        Args:
            texts: List of texts to embed

        Returns:
            List of numpy arrays containing embeddings
        """
        if self._EMBEDDING_CLIENT is None:
            raise RuntimeError(
                f"SemanticSimilarityEvent '{self.event_id}' has no "
                f"embedding client. Ensure the event is created using the "
                f".create() class method with an embedding_client."
            )
        return await self._EMBEDDING_CLIENT.get_embeddings_batch(
            texts, task=LLMTask.EVENT_EMBEDDING.value
        )

    @staticmethod
    def _cosine_similarity(vec1: np.ndarray, vec2: np.ndarray) -> float:
        """
        Calculate cosine similarity between two vectors.

        Args:
            vec1: First vector
            vec2: Second vector

        Returns:
            Cosine similarity score (0-1 range, 1 being identical)
        """
        # Normalize vectors
        vec1_norm = vec1 / (np.linalg.norm(vec1) + 1e-9)
        vec2_norm = vec2 / (np.linalg.norm(vec2) + 1e-9)

        # Compute dot product (cosine similarity for normalized vectors)
        return float(np.dot(vec1_norm, vec2_norm))
