"""
Shadow-mode pre-filter for the STT Coherence Guard.

This module NEVER decides whether the guard fires — it only computes a cheap,
local, LLM-free verdict so it can be logged alongside the real classifier's
verdict for comparison. The whole point is to measure how well a cheap signal
predicts the real guard's outcome, with real production data, before anyone
trusts it to actually skip the expensive call. See the plan this shipped
under: optimizing the STT Coherence Guard's latency (a confirmed 1.1-4.3s tax
on every turn, every scenario, platform-wide) without silently regressing its
one job — catching genuine mis-transcription.

Two signals, both deliberately language-agnostic:
  1. A repeated-character-run / runaway-token heuristic for outright gibberish
     (works on any script — no dictionary or vowel-pattern check, which this
     repo's own STT-confidence gotcha says behaves inconsistently across
     Indian languages).
  2. Embedding-similarity drift between the counselor's message and recent
     conversation context, for the "coherent words, abruptly unrelated"
     mis-transcription case the guard's own prompt examples describe.

The similarity threshold below is a PLACEHOLDER, not a tuned value — shadow
mode exists specifically to replace this guess with a real number.
"""

import re
from typing import ClassVar, Optional, Tuple

import numpy as np

from app.core.embeddings import BaseEmbeddingClient
from app.core.logger import get_logger

logger = get_logger(__name__)


class CoherencePrefilter:
    """Class-level embedding client, same pattern as SemanticSimilarityEvent's
    _EMBEDDING_CLIENT (survives LangGraph's checkpointer round-trip, shared
    once per worker process — see that class for the full rationale)."""

    _EMBEDDING_CLIENT: ClassVar[Optional[BaseEmbeddingClient]] = None

    # 4+ consecutive repeats of the same character, in any script.
    _REPEAT_RUN_THRESHOLD: ClassVar[int] = 4
    # A single whitespace-delimited token longer than this is treated as
    # runaway/garbled rather than a real word in any language this platform
    # serves.
    _MAX_SANE_TOKEN_LENGTH: ClassVar[int] = 40
    # PLACEHOLDER — not tuned from real data. See module docstring.
    _DRIFT_SIMILARITY_THRESHOLD: ClassVar[float] = 0.3

    @classmethod
    def is_likely_gibberish(cls, text: str) -> bool:
        """Cheap, language-agnostic garble check — no LLM, no network call."""
        stripped = text.strip()
        if not stripped:
            return False
        if re.search(rf"(.)\1{{{cls._REPEAT_RUN_THRESHOLD - 1},}}", stripped):
            return True
        longest_token = max((len(t) for t in stripped.split()), default=0)
        return longest_token > cls._MAX_SANE_TOKEN_LENGTH

    @classmethod
    async def drift_score(
        cls, counselor_message: str, recent_context: str
    ) -> Optional[float]:
        """Cosine similarity between the message and recent context.

        Returns None (not a verdict) when there's no embedding client
        configured, or either input is empty — callers must treat None as
        "no signal", never coerce it to a flag.
        """
        if cls._EMBEDDING_CLIENT is None:
            return None
        message = counselor_message.strip()
        context = recent_context.strip()
        if not message or not context:
            return None
        try:
            message_embedding, context_embedding = (
                await cls._EMBEDDING_CLIENT.get_embeddings_batch([message, context])
            )
        except Exception as e:
            logger.debug(f"[GUARDRAIL_SHADOW] drift embedding failed: {e}")
            return None
        return cls._cosine_similarity(message_embedding, context_embedding)

    @classmethod
    async def would_flag(
        cls, counselor_message: str, recent_context: str
    ) -> Tuple[bool, Optional[float]]:
        """Combined shadow verdict plus the raw drift score for logging.

        The gibberish check alone can flag True with no embedding client
        configured at all (e.g. in tests) — drift_score's None just means
        that half of the signal didn't run, not that nothing did.
        """
        if cls.is_likely_gibberish(counselor_message):
            return True, None
        score = await cls.drift_score(counselor_message, recent_context)
        if score is None:
            return False, None
        return score < cls._DRIFT_SIMILARITY_THRESHOLD, score

    @staticmethod
    def _cosine_similarity(vec1: np.ndarray, vec2: np.ndarray) -> float:
        vec1_norm = vec1 / (np.linalg.norm(vec1) + 1e-9)
        vec2_norm = vec2 / (np.linalg.norm(vec2) + 1e-9)
        return float(np.dot(vec1_norm, vec2_norm))
