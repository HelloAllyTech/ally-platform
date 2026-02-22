"""
Similarity event for runtime instantiation from YAML sentences.
Refactored with abstractions for multilingual support.
"""

from typing import ClassVar, Dict, List, Optional, Tuple

from pydantic import PrivateAttr
from typing_extensions import override

from app.core.constants import DEFAULT_LANGUAGE_CODE, SimilarityEventConfig
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.similarity_based.base import TargetPattern
from app.core.events.event_types.similarity_based.constants import (
    MATCH_THRESHOLD,
    MIN_MATCH_TOKENS,
)
from app.core.events.event_types.similarity_based.stopwords_provider import (
    StopwordsProvider,
    get_stopwords_provider,
)
from app.core.events.event_types.similarity_based.text_processor import TextProcessor
from app.core.events.event_types.similarity_based.text_processor_factory import (
    TextProcessorFactory,
)
from app.core.logger import get_logger

logger = get_logger(__name__)


class SimilarityEvent(BaseEvent):
    """
    Similarity-based event instantiated from YAML sentences.

    Uses shared pattern cache for performance across instances with
    identical configurations.
    Now supports multilingual processing through abstractions.
    """

    # Regular fields that survive serialization
    sentences: List[str] = []
    language_code: str = (
        # Store as regular field to survive LangGraph deserialization
        DEFAULT_LANGUAGE_CODE
    )

    # Private attributes for transient/computed state
    _match_threshold: float = PrivateAttr(default=SimilarityEventConfig.match_threshold)
    _min_match_tokens: int = PrivateAttr(default=SimilarityEventConfig.min_match_tokens)
    _text_processor: TextProcessor = PrivateAttr(default=None)
    _stopwords_provider: StopwordsProvider = PrivateAttr(default=None)
    _stopwords: frozenset[str] = PrivateAttr(default=None)

    _instance_patterns: List[TargetPattern] = PrivateAttr(default_factory=list)
    _instance_built: bool = PrivateAttr(default=False)

    @property
    def text_processor(self) -> TextProcessor:
        """
        Property getter that ensures _text_processor is always initialized.
        This prevents AttributeError when accessing _text_processor after
        deserialization.
        """
        if self._text_processor is not None:
            return self._text_processor

        lang_code = self.language_code or DEFAULT_LANGUAGE_CODE

        try:
            self._text_processor = TextProcessorFactory.get_processor(lang_code)
            return self._text_processor
        except Exception:
            pass

        from app.core.events.event_types.similarity_based.text_processor import (
            UnifiedTextProcessor,
        )

        try:
            self._text_processor = UnifiedTextProcessor(language_code=lang_code)
            return self._text_processor
        except Exception as fallback_error:
            if lang_code != DEFAULT_LANGUAGE_CODE:
                try:
                    self._text_processor = UnifiedTextProcessor(
                        language_code=DEFAULT_LANGUAGE_CODE
                    )
                    return self._text_processor
                except Exception:
                    raise ValueError(
                        f"Failed to initialize text processor for event "
                        f"'{self.event_id}' with language '{lang_code}' and "
                        f"fallback to '{DEFAULT_LANGUAGE_CODE}'. "
                        f"This indicates a critical configuration issue."
                    )
            else:
                raise ValueError(
                    f"Failed to initialize text processor for event "
                    f"'{self.event_id}' with default language "
                    f"'{DEFAULT_LANGUAGE_CODE}'. "
                    f"This indicates a critical configuration issue. "
                    f"Original error: {fallback_error}"
                )

    # Shared cache across instances:
    # (sentences_hash, threshold, min_tokens, stopwords_hash, language_code)
    # -> patterns
    _PATTERN_CACHE: ClassVar[
        Dict[Tuple[int, float, int, int, str], List[TargetPattern]]
    ] = {}

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        custom_sentences: List[str],
        match_threshold: Optional[float] = SimilarityEventConfig.match_threshold,
        min_match_tokens: Optional[int] = SimilarityEventConfig.min_match_tokens,
        language_code: Optional[str] = DEFAULT_LANGUAGE_CODE,
        **kwargs,
    ) -> "SimilarityEvent":
        """
        Create a SimilarityEvent with Pydantic-safe construction.

        Args:
            event_id: Unique event identifier
            custom_sentences: List of target sentences to match against
            match_threshold: Token coverage threshold (0-1), default 0.6
            min_match_tokens: Minimum number of tokens to match, default 2
            language_code: Language code for text processing (e.g., "en-IN", "hi-IN")
            **kwargs: Additional BaseEvent fields (score, emoji, visibility_type, etc.)
        """
        inst: SimilarityEvent = cls.model_construct(
            event_id=event_id,
            sentences=list(custom_sentences or []),
            language_code=language_code or DEFAULT_LANGUAGE_CODE,
            **kwargs,
        )
        inst._match_threshold = (
            match_threshold if match_threshold is not None else MATCH_THRESHOLD
        )
        inst._min_match_tokens = (
            min_match_tokens if min_match_tokens is not None else MIN_MATCH_TOKENS
        )

        # Initialize _text_processor (property getter will handle lazy
        # initialization if needed)
        _ = inst.text_processor

        inst._stopwords_provider = get_stopwords_provider(use_multilingual=True)
        inst._stopwords = inst._stopwords_provider.get_stopwords(inst.language_code)

        inst._instance_patterns = []
        inst._instance_built = False
        return inst

    # ---------- Detection ----------
    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """Detect the event in the given conversation (final utterance by counselor)."""
        if conversations:
            last = conversations[-1]
            if last.role.lower() == "counselor":
                matched = self._match(last.content)
                return matched
        return False

    def _match(self, sentence: str) -> bool:
        # This will lazily initialize _text_processor if needed
        self._ensure_patterns_built()

        # Use abstracted text processor (via property to ensure initialization)
        normalized_sentence: str = self.text_processor.normalize(sentence)
        if not normalized_sentence:
            return False

        # Use abstracted tokenizer (via property to ensure initialization)
        sentence_token_set: set[str] = set(
            self.text_processor.tokenize(normalized_sentence)
        )
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
            required_overlap = min(
                self._min_match_tokens, len(informative_target_tokens)
            )
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
        # Handle None case explicitly (shouldn't happen, but fail fast if it does)
        if self.sentences is None:
            raise ValueError(
                f"sentences is None for event '{self.event_id}'. "
                f"This indicates a bug in event initialization."
            )

        if not self.sentences:
            self._instance_patterns = []
            self._instance_built = True
            return

        # Ensure _text_processor is initialized (property getter handles this)
        _ = self.text_processor

        if self._stopwords is None or self._stopwords_provider is None:
            lang_code = self.language_code or DEFAULT_LANGUAGE_CODE
            try:
                if self._stopwords_provider is None:
                    self._stopwords_provider = get_stopwords_provider(
                        use_multilingual=True
                    )
                self._stopwords = self._stopwords_provider.get_stopwords(lang_code)
            except Exception as e:
                logger.error(
                    f"Failed to get stopwords for language '{lang_code}': {e}, "
                    f"using empty set as fallback"
                )
                self._stopwords = frozenset()

        # Deduplicate and strip surrounding quotes/whitespace
        deduped: List[str] = []
        seen: set[str] = set()
        for s in self.sentences:
            cleaned = s.strip().strip("\"'")
            if cleaned and cleaned not in seen:
                seen.add(cleaned)
                deduped.append(cleaned)

        # Cache key from normalized phrases and tunables
        normalized_phrases = [self.text_processor.normalize(p) for p in deduped]
        sentences_key = hash(tuple(normalized_phrases))
        stopwords_key = hash(tuple(sorted(self._stopwords)))
        cache_key = (
            sentences_key,
            float(self._match_threshold),
            int(self._min_match_tokens),
            stopwords_key,
            self.language_code,  # Include language in cache key
        )

        cached = self._PATTERN_CACHE.get(cache_key)
        if cached is not None:
            self._instance_patterns = cached
            self._instance_built = True
            return

        # Build patterns using abstracted processors
        patterns: List[TargetPattern] = []
        for original, normalized in zip(deduped, normalized_phrases):
            # Use abstracted tokenizer (via property to ensure initialization)
            token_set = frozenset(self.text_processor.tokenize(normalized))
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
