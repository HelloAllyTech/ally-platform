import re
import unicodedata
from abc import ABC
from collections.abc import Sequence
from dataclasses import dataclass
from typing import ClassVar, List

from typing_extensions import override

from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.similarity_based.constants import DEFAULT_STOPWORDS


# ---------- Data model ----------
@dataclass(frozen=True)
class TargetPattern:
    """Normalized + tokenized representation of a phrase pattern."""

    original: str
    normalized: str
    tokens: frozenset[str]
    informative_tokens: frozenset[str]


# ---------- Base class (subclasses MUST define `similar_sentences`) ----------
class SimilarityBaseEvent(BaseEvent, ABC):
    """
    Simple similarity matcher against a curated phrase list.

    Decision per sentence:
      1) If any target's normalized text is a substring of the normalized
         sentence → match.
      2) Else, coverage = (# informative target tokens found in sentence) /
         (informative target tokens).
         If coverage ≥ MATCH_THRESHOLD (and ≥ MIN_MATCH_TOKENS overlap when
         applicable) → match.

    Early stopping is used (returns on the first match).
    """

    # ---- Required in subclasses ----
    similar_sentences: ClassVar[Sequence[str]]  # MUST be defined by subclass

    # ---- Tunables ----
    MATCH_THRESHOLD: ClassVar[float] = 0.6
    MIN_MATCH_TOKENS: ClassVar[int] = 2
    STOPWORDS: ClassVar[frozenset[str]] = DEFAULT_STOPWORDS

    # ---- Internal cache (per subclass; built lazily once) ----
    _patterns: ClassVar[list[TargetPattern]] = []
    _built: ClassVar[bool] = False

    def _match(self, sentence: str) -> bool:
        """Return True if `sentence` is similar to any curated phrase in
        `similar_sentences`."""
        self._ensure_patterns_built()

        normalized_sentence: str = self._normalize(sentence)
        if not normalized_sentence:
            return False

        sentence_token_set: set[str] = set(self._tokens(normalized_sentence))
        if not sentence_token_set:
            return False

        # 1) Fast path: direct substring of normalized text
        for pattern in self._patterns:
            if pattern.normalized in normalized_sentence:
                return True  # early stop on first hit

        # 2) Token coverage over informative tokens
        for pattern in self._patterns:
            informative_target_tokens = pattern.informative_tokens
            if not informative_target_tokens:
                continue  # skip degenerate targets

            overlap_tokens = sentence_token_set & informative_target_tokens

            # Guard against trivial hits on longer targets
            required_overlap = min(
                self.MIN_MATCH_TOKENS, len(informative_target_tokens)
            )
            if len(overlap_tokens) < required_overlap:
                continue

            coverage = len(overlap_tokens) / float(len(informative_target_tokens))
            if coverage >= self.MATCH_THRESHOLD:
                return True  # early stop on first qualifying coverage

        return False

    # --------------- Build & Helpers ---------------
    @classmethod
    def _ensure_patterns_built(cls) -> None:
        """Prepare normalized/tokenized target patterns once (per subclass;
        lazy build)."""
        if cls._built:
            return

        phrase_list = getattr(cls, "similar_sentences", None)
        if (
            not isinstance(phrase_list, (list, tuple))
            or not phrase_list
            or not all(isinstance(x, str) for x in phrase_list)
        ):
            raise NotImplementedError(
                f"{cls.__name__}.similar_sentences must be a non-empty "
                f"list/tuple of strings."
            )

        # Deduplicate and strip surrounding quotes/whitespace
        seen_phrases: set[str] = set()
        deduplicated_phrases: list[str] = []
        for raw_phrase in phrase_list:
            cleaned_phrase = raw_phrase.strip().strip('"').strip("“”").strip()
            if cleaned_phrase and cleaned_phrase not in seen_phrases:
                seen_phrases.add(cleaned_phrase)
                deduplicated_phrases.append(cleaned_phrase)

        # Build normalized patterns
        pattern_list: list[TargetPattern] = []
        for phrase in deduplicated_phrases:
            normalized_phrase = cls._normalize(phrase)
            token_set = frozenset(cls._tokens(normalized_phrase))
            informative_token_set = frozenset(token_set - cls.STOPWORDS)
            pattern_list.append(
                TargetPattern(
                    original=phrase,
                    normalized=normalized_phrase,
                    tokens=token_set,
                    informative_tokens=informative_token_set,
                )
            )

        cls._patterns = pattern_list
        cls._built = True

    @staticmethod
    def _normalize(text: str) -> str:
        """
        Unicode NFKC → lowercase → remove punctuation → collapse whitespace.
        Converts curly apostrophes to straight for consistency.
        """
        if not text:
            return ""
        text_processed = unicodedata.normalize("NFKC", text)
        text_processed = text_processed.replace("’", "'").lower()
        text_processed = re.sub(
            r"[^\w\s]", " ", text_processed
        )  # keep letters/digits/underscore + spaces
        text_processed = re.sub(r"\s+", " ", text_processed).strip()
        return text_processed

    @staticmethod
    def _tokens(normalized_text: str) -> list[str]:
        """Split on spaces; caller ensures text is already normalized."""
        return [token for token in normalized_text.split() if token]

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detect the event in the given conversation.

        Args:
            conversations (List[ChatMessage]): The conversation to search for events.

        Returns:
            bool: True if the event is detected, False otherwise.
        """
        if conversations:
            return conversations[-1].role.lower() == "counselor" and self._match(
                conversations[-1].content
            )
        return False
