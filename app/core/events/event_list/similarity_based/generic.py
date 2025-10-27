"""
Generic similarity event for runtime instantiation from YAML sentences.
"""
import re
import unicodedata
from dataclasses import dataclass
from typing import List, Optional, Tuple, Dict, override

from pydantic import PrivateAttr

from app.core.constants import SimilarityEventConfig
from app.core.events.base import BaseEvent
from app.core.events.schemas import ChatMessage
from app.core.events.event_list.similarity_based.constants import DEFAULT_STOPWORDS


@dataclass(frozen=True)
class TargetPattern:
    """Normalized + tokenized representation of a phrase pattern."""
    original: str
    normalized: str
    tokens: frozenset[str]
    informative_tokens: frozenset[str]


class GenericSimilarityEvent(BaseEvent):
    """
    Generic similarity-based event instantiated from YAML sentences.
    
    Uses shared pattern cache for performance across instances with identical configurations.
    """

    # Regular field that survives serialization
    sentences: List[str] = []
    
    # Private attributes for transient/computed state
    _match_threshold: float = PrivateAttr(default=SimilarityEventConfig.match_threshold)
    _min_match_tokens: int = PrivateAttr(default=SimilarityEventConfig.min_match_tokens)
    _stopwords: frozenset[str] = PrivateAttr(default_factory=lambda: DEFAULT_STOPWORDS)

    _instance_patterns: List[TargetPattern] = PrivateAttr(default_factory=list)
    _instance_built: bool = PrivateAttr(default=False)

    # Shared cache across instances: (sentences_hash, threshold, min_tokens, stopwords_hash) -> patterns
    _PATTERN_CACHE: Dict[Tuple[int, float, int, int], List[TargetPattern]] = {}

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        custom_sentences: List[str],
        match_threshold: Optional[float] = SimilarityEventConfig.match_threshold,
        min_match_tokens: Optional[int] = SimilarityEventConfig.min_match_tokens,
        **kwargs,
    ) -> "GenericSimilarityEvent":
        """
        Create a GenericSimilarityEvent with Pydantic-safe construction.
        
        BaseEvent fields (event_id, visibility_type, score, emoji, etc.) are passed via kwargs.
        """
        inst: GenericSimilarityEvent = cls.model_construct(
            event_id=event_id,
            sentences=list(custom_sentences or []),
            **kwargs
        )
        inst._match_threshold = match_threshold if match_threshold is not None else 0.6
        inst._min_match_tokens = min_match_tokens if min_match_tokens is not None else 2
        inst._stopwords = DEFAULT_STOPWORDS
        inst._instance_patterns = []
        inst._instance_built = False
        return inst

    # ---------- Detection ----------
    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """Detect the event in the given conversation (final utterance by counselor)."""
        if conversations:
            last = conversations[-1]
            return last.role.lower() == "counselor" and self._match(last.content)
        return False

    def _match(self, sentence: str) -> bool:
        self._ensure_patterns_built()

        normalized_sentence: str = self._normalize(sentence)
        if not normalized_sentence:
            return False

        sentence_token_set: set[str] = set(self._tokens(normalized_sentence))
        if not sentence_token_set:
            return False

        # 1) Fast path: direct substring of normalized text
        for pattern in self._instance_patterns:
            if pattern.normalized in normalized_sentence:
                return True

        # 2) Token coverage over informative tokens
        for pattern in self._instance_patterns:
            informative_target_tokens = pattern.informative_tokens
            if not informative_target_tokens:
                continue

            overlap_tokens = sentence_token_set & informative_target_tokens

            # Guard against trivial hits on longer targets
            required_overlap = min(self._min_match_tokens, len(informative_target_tokens))
            if len(overlap_tokens) < required_overlap:
                continue

            coverage = len(overlap_tokens) / float(len(informative_target_tokens))
            if coverage >= self._match_threshold:
                return True

        return False

    # ---------- Build & Helpers ----------
    def _ensure_patterns_built(self) -> None:
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
            cleaned = s.strip().strip('"\'')
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                deduped.append(cleaned)

        # Cache key from normalized phrases and tunables
        normalized_phrases = [self._normalize(p) for p in deduped]
        sentences_key = hash(tuple(normalized_phrases))
        stopwords_key = hash(tuple(sorted(self._stopwords)))
        cache_key = (
            sentences_key,
            float(self._match_threshold),
            int(self._min_match_tokens),
            stopwords_key,
        )

        cached = self._PATTERN_CACHE.get(cache_key)
        if cached is not None:
            self._instance_patterns = cached
            self._instance_built = True
            return

        patterns: List[TargetPattern] = []
        for original, normalized in zip(deduped, normalized_phrases):
            token_set = frozenset(self._tokens(normalized))
            informative_token_set = frozenset(token_set - self._stopwords)
            patterns.append(
                TargetPattern(
                    original=original,
                    normalized=normalized,
                    tokens=token_set,
                    informative_tokens=informative_token_set,
                )
            )

        self._PATTERN_CACHE[cache_key] = patterns
        self._instance_patterns = patterns
        self._instance_built = True

    @staticmethod
    def _normalize(text: str) -> str:
        if not text:
            return ""
        text_processed = unicodedata.normalize("NFKC", text)
        text_processed = text_processed.replace("'", "'").lower()
        text_processed = re.sub(r"[^\w\s]", " ", text_processed)
        text_processed = re.sub(r"\s+", " ", text_processed).strip()
        return text_processed

    @staticmethod
    def _tokens(normalized_text: str) -> List[str]:
        return [t for t in normalized_text.split() if t]
