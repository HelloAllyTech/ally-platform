"""
Abstract interface for text processing (normalization and tokenization).
Allows language-aware implementations for multilingual support.
"""

import re
import unicodedata
from abc import ABC, abstractmethod
from typing import List

from app.core.constants import DEFAULT_LANGUAGE_CODE


class TextProcessor(ABC):
    """Abstract interface for language-aware text processing."""

    @abstractmethod
    def normalize(self, text: str) -> str:
        """
        Normalize text for matching.

        Args:
            text: Raw input text

        Returns:
            Normalized text ready for tokenization
        """
        pass

    @abstractmethod
    def tokenize(self, normalized_text: str) -> List[str]:
        """
        Tokenize normalized text into tokens.

        Args:
            normalized_text: Pre-normalized text

        Returns:
            List of tokens
        """
        pass


class UnifiedTextProcessor(TextProcessor):
    """
    Unified text processor that works for most languages.

    Handles:
    - English (Latin script)
    - Hindi (Devanagari script)
    - Bengali (Bengali script)
    - Tamil (Tamil script)
    - Telugu (Telugu script)
    - And other space-separated languages

    Uses Unicode-aware normalization and tokenization.

    Args:
        language_code: Language code (for future language-specific tweaks)
        preserve_case: If True, don't lowercase (useful for
            case-sensitive languages)
        remove_punctuation: If True, remove punctuation marks
    """

    def __init__(
        self,
        language_code: str = DEFAULT_LANGUAGE_CODE,
        preserve_case: bool = False,
        remove_punctuation: bool = True,
    ):
        self.language_code = language_code
        self.preserve_case = preserve_case
        self.remove_punctuation = remove_punctuation

        # Language-specific configuration (can be extended)
        self._language_config = self._get_language_config(language_code)

    def _get_language_config(self, language_code: str) -> dict:
        """Get language-specific configuration."""
        base_lang = language_code.split("-")[0].lower()

        # Most Indic languages don't have case, but we lowercase anyway for consistency
        # Some languages might need special handling in the future
        configs = {
            "en": {"preserve_case": False, "remove_punctuation": True},
            "hi": {"preserve_case": False, "remove_punctuation": True},
            "bn": {"preserve_case": False, "remove_punctuation": True},
            "ta": {"preserve_case": False, "remove_punctuation": True},
            "te": {"preserve_case": False, "remove_punctuation": True},
            "mr": {"preserve_case": False, "remove_punctuation": True},
            "gu": {"preserve_case": False, "remove_punctuation": True},
            "kn": {"preserve_case": False, "remove_punctuation": True},
            "ml": {"preserve_case": False, "remove_punctuation": True},
            "pa": {"preserve_case": False, "remove_punctuation": True},
            "or": {"preserve_case": False, "remove_punctuation": True},
            "as": {"preserve_case": False, "remove_punctuation": True},
            "ur": {"preserve_case": False, "remove_punctuation": True},
        }

        return configs.get(base_lang, configs["en"])

    def normalize(self, text: str) -> str:
        """
        Normalize text for matching.

        Works for:
        - Latin script (English)
        - Devanagari (Hindi, Marathi, etc.)
        - Bengali script
        - Tamil script
        - Telugu script
        - And other Unicode scripts
        """
        if not text:
            return ""

        # Step 1: Unicode normalization (handles all scripts)
        text_processed = unicodedata.normalize("NFKC", text)

        # Step 2: Handle quotes (language-agnostic)
        text_processed = text_processed.replace("'", "'")
        text_processed = text_processed.replace(
            """, '"')
        text_processed = text_processed.replace(""",
            '"',
        )

        # Step 3: Lowercase (works for most languages)
        # Note: Some scripts don't have case, but lower() is safe
        if not self._language_config.get("preserve_case", False):
            text_processed = text_processed.lower()

        # Step 4: Remove punctuation (Unicode-aware)
        # \w in Python regex includes Unicode word characters (works for Indic scripts)
        if self._language_config.get("remove_punctuation", True):
            text_processed = re.sub(r"[^\w\s]", " ", text_processed)

        # Step 5: Normalize whitespace
        text_processed = re.sub(r"\s+", " ", text_processed).strip()

        return text_processed

    def tokenize(self, normalized_text: str) -> List[str]:
        """
        Tokenize normalized text.

        Uses whitespace splitting, which works for:
        - All space-separated languages (most languages including all Indian languages)
        - For languages without spaces (Chinese, Japanese), override this method
        """
        return [t for t in normalized_text.split() if t]
