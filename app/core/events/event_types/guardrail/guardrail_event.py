"""
Guardrail event detection using semantic similarity.

Each GuardrailEvent wraps one guardrail entry from the backend.
Detects when the counselor says something semantically matching
helperDialogue, then guides the agent to respond with actorDialogue
via a branching instruction.
"""

from dataclasses import dataclass
from typing import ClassVar, List, Optional

import numpy as np
from pydantic import BaseModel, PrivateAttr
from typing_extensions import override

from app.core.constants import DetectionType
from app.core.embeddings import BaseEmbeddingClient
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.guardrail.constants import GUARDRAIL_SIMILARITY_THRESHOLD
from app.core.events.event_types.guardrail.schemas import GuardrailData
from app.core.logger import get_logger

logger = get_logger(__name__)

GUARDRAIL_SIMILARITY_THRESHOLD = 0.72


class GuardrailData(BaseModel):
    """
    Data payload for a single guardrail.

    helper_dialogue : what the counselor says to TRIGGER the guardrail
    actor_dialogue  : what the AI agent should be guided to say back
    """

    helper_dialogue: str
    actor_dialogue: str


@dataclass(frozen=True)
class _EmbeddedPattern:
    """A sentence with its precomputed embedding."""

    original: str
    embedding: np.ndarray


class GuardrailEvent(BaseEvent):
    """
    Fires when the counselor's utterance semantically matches
    a guardrail's helperDialogue.

    When triggered:
    - branching_instruction is set to actorDialogue so LLM is guided
    - PASSIVE visibility — no score card shown to counselor
    - score = 0 — no scoring impact
    - trigger_multiple = True — can fire multiple times per session
    """

    detection_type: DetectionType = DetectionType.GUARDRAIL
    data: GuardrailData
    similarity_threshold: float = GUARDRAIL_SIMILARITY_THRESHOLD

    # Private: cached embedding of helperDialogue (not serialised by Pydantic)
    _pattern: Optional[_EmbeddedPattern] = PrivateAttr(default=None)
    _pattern_built: bool = PrivateAttr(default=False)

    # Class-level embedding client shared across ALL guardrail event instances.
    # Stored at class level because LangGraph's MemorySaver serialises/deserialises
    # state between nodes using model_dump/model_construct, which wipes PrivateAttr.
    # Same pattern as SemanticSimilarityEvent — survives LangGraph serialisation.
    _EMBEDDING_CLIENT: ClassVar[Optional[BaseEmbeddingClient]] = None

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: GuardrailData,
        embedding_client: Optional[BaseEmbeddingClient] = None,
        similarity_threshold: float = GUARDRAIL_SIMILARITY_THRESHOLD,
        **kwargs,
    ) -> "GuardrailEvent":
        """
        Factory method — always use this instead of direct construction.

        branching_instruction should be pre-set in kwargs by the caller
        (Scenario.create) so actorDialogue guides the LLM response.
        """
        if cls._EMBEDDING_CLIENT is None and embedding_client is not None:
            cls._EMBEDDING_CLIENT = embedding_client

        inst: GuardrailEvent = cls.model_construct(
            event_id=event_id,
            detection_type=DetectionType.GUARDRAIL,
            data=data,
            similarity_threshold=similarity_threshold,
            **kwargs,
        )
        # Explicitly initialise private attrs after model_construct
        # (model_construct skips __init__ so PrivateAttr defaults are not set)
        inst._pattern = None
        inst._pattern_built = False
        return inst

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Returns True if the counselor's last message semantically matches
        this guardrail's helperDialogue.

        Only counselor messages are checked — the AI agent cannot trigger
        its own guardrails.
        """
        if not conversations:
            return False

        last = conversations[-1]
        if last.role.lower() != "counselor":
            return False

        return await self._matches_helper_dialogue(last.content)

    async def _matches_helper_dialogue(self, text: str) -> bool:
        """Cosine similarity check against helperDialogue embedding."""
        if not text.strip():
            return False

        await self._ensure_pattern_built()

        if self._pattern is None:
            return False

        try:
            input_embedding = await self._get_embedding(text)
        except Exception as e:
            logger.exception(
                "GuardrailEvent %s: failed to get embedding for counselor text: %s",
                self.event_id,
                e,
            )
            return False

        similarity = _cosine_similarity(input_embedding, self._pattern.embedding)

        if similarity >= self.similarity_threshold:
            logger.info(
                "Guardrail TRIGGERED | event=%s | similarity=%.3f | "
                "counselor='%s...' | trigger='%s...'",
                self.event_id,
                similarity,
                text[:60],
                self.data.helper_dialogue[:60],
            )
            return True

        return False

    async def _ensure_pattern_built(self) -> None:
        """Build and cache the embedding for helperDialogue (runs once per event)."""
        if self._pattern_built:
            return

        try:
            embedding = await self._get_embedding(self.data.helper_dialogue)
            self._pattern = _EmbeddedPattern(
                original=self.data.helper_dialogue,
                embedding=embedding,
            )
            logger.debug(
                "GuardrailEvent %s: built embedding for helperDialogue='%s...'",
                self.event_id,
                self.data.helper_dialogue[:60],
            )
        except Exception as e:
            logger.exception(
                "GuardrailEvent %s: failed to build helperDialogue embedding: %s",
                self.event_id,
                e,
            )
            self._pattern = None

        self._pattern_built = True

    async def _get_embedding(self, text: str) -> np.ndarray:
        """Delegate to the class-level embedding client."""
        if self._EMBEDDING_CLIENT is None:
            raise RuntimeError(
                f"GuardrailEvent '{self.event_id}' has no embedding client. "
                "Ensure embedding_client is passed to GuardrailEvent.create()."
            )
        return await self._EMBEDDING_CLIENT.get_embedding(text)


def _cosine_similarity(vec1: np.ndarray, vec2: np.ndarray) -> float:
    """Cosine similarity between two vectors, returns value in [0, 1]."""
    norm1 = np.linalg.norm(vec1)
    norm2 = np.linalg.norm(vec2)
    if norm1 == 0 or norm2 == 0:
        return 0.0
    return float(np.dot(vec1 / norm1, vec2 / norm2))