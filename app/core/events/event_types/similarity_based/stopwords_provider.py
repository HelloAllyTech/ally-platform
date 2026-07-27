"""
Abstract interface for stopwords providers.
Allows library-based, custom, or hybrid implementations for multilingual support.
"""

import logging
from abc import ABC, abstractmethod
from typing import FrozenSet, Set

from app.core.config import settings

logger = logging.getLogger(__name__)

# Try to import libraries
try:
    from stopwordsiso import stopwords as stopwords_iso_stopwords

    STOPWORDS_ISO_AVAILABLE = True
except ImportError:
    stopwords_iso_stopwords = None
    STOPWORDS_ISO_AVAILABLE = False
    logger.warning("stopwordsiso not installed. Install with: pip install stopwordsiso")

# advertools pulls in pandas (~50MB) purely to expose a static stopwords dict for
# a handful of languages stopwords-iso doesn't cover (Tamil/Telugu/Urdu). When
# settings.VENDORED_STOPWORDS_ENABLED is True (default), those languages are
# served from vendored_stopwords.py instead and advertools is never imported.
# Set the flag to False to fall back to the advertools-backed lookup.
if settings.VENDORED_STOPWORDS_ENABLED:
    from app.core.events.event_types.similarity_based.vendored_stopwords import (
        VENDORED_STOPWORDS,
    )

    ADVERTOOLS_AVAILABLE = False
    adv = None
else:
    try:
        import advertools as adv

        ADVERTOOLS_AVAILABLE = True
    except ImportError:
        ADVERTOOLS_AVAILABLE = False
        logger.warning("advertools not installed. Install with: pip install advertools")

# Language code mapping
# stopwords-iso uses ISO 639-1 codes (hi, bn, mr)
# advertools uses language names (hindi, bengali, tamil, telugu, urdu)
LANGUAGE_MAPPING = {
    "hi-IN": {"iso": "hi", "advertools": "hindi"},
    "bn-IN": {"iso": "bn", "advertools": "bengali"},
    "mr-IN": {"iso": "mr", "advertools": None},  # Only in stopwords-iso
    "ta-IN": {"iso": None, "advertools": "tamil"},  # Only in advertools
    "te-IN": {"iso": None, "advertools": "telugu"},  # Only in advertools
    "ur-IN": {"iso": None, "advertools": "urdu"},  # Only in advertools
    "en-IN": {"iso": "en", "advertools": "english"},
    "ml-IN": {
        "iso": None,
        "advertools": None,
    },  # Malayalam - custom stopwords (empty for now)
    "kn-IN": {
        "iso": None,
        "advertools": None,
    },  # Kannada - custom stopwords (empty for now)
    # Add more mappings as needed
}

# Custom domain-specific stopwords (counseling/mental health context)
# Can be extended per language
DOMAIN_SPECIFIC_STOPWORDS = {
    "en-IN": set(
        [
            # Add counseling-specific words that libraries might miss
            # or words that are too generic in your context
        ]
    ),
    "hi-IN": set(
        [
            # Hindi counseling-specific (add as needed)
        ]
    ),
    "ml-IN": set(
        [
            # Malayalam stopwords - empty for now, will fallback to English
            # Can be populated later with comprehensive lists
        ]
    ),
    "kn-IN": set(
        [
            # Kannada stopwords - empty for now, will fallback to English
            # Can be populated later with comprehensive lists
        ]
    ),
    # Add more as needed
}

# Words to REMOVE from library stopwords (important in your domain)
DOMAIN_IMPORTANT_WORDS = {
    "en-IN": set(
        [
            # Keep these even if in library stopwords
            "feel",
            "feeling",
            "emotion",  # Important for counseling
        ]
    ),
    # Add more as needed
}


class StopwordsProvider(ABC):
    """Abstract interface for stopwords providers."""

    @abstractmethod
    def get_stopwords(self, language_code: str) -> FrozenSet[str]:
        """
        Get stopwords for a given language.

        Args:
            language_code: Language code (e.g., "en-IN", "hi-IN")

        Returns:
            FrozenSet of stopwords
        """
        pass


class DefaultStopwordsProvider(StopwordsProvider):
    """Default provider using hardcoded English stopwords (backward compatible)."""

    def get_stopwords(self, language_code: str) -> FrozenSet[str]:
        """Return default English stopwords."""
        from app.core.events.event_types.similarity_based.constants import (
            DEFAULT_STOPWORDS,
        )

        return DEFAULT_STOPWORDS


class MultilingualStopwordsProvider(StopwordsProvider):
    """
    Multilingual provider using libraries (stopwords-iso + advertools).
    Falls back to default English if language not found.

    Uses hybrid approach:
    1. Get base stopwords from library (stopwords-iso or advertools)
    2. Add domain-specific custom stopwords
    3. Remove domain-important words (even if in library)
    """

    def __init__(self):
        self._library_cache: dict[str, FrozenSet[str]] = {}

    def get_stopwords(self, language_code: str) -> FrozenSet[str]:
        """
        Get stopwords for a given language using hybrid approach.

        Args:
            language_code: Language code (e.g., "en-IN", "hi-IN")

        Returns:
            FrozenSet of stopwords
        """
        if language_code in self._library_cache:
            return self._library_cache[language_code]

        # Step 1: Get base from library
        base_stopwords = self._get_from_libraries(language_code)

        # Step 2: Add domain-specific custom stopwords
        custom_stopwords = DOMAIN_SPECIFIC_STOPWORDS.get(language_code, set())

        # Step 3: Remove domain-important words
        important_words = DOMAIN_IMPORTANT_WORDS.get(language_code, set())

        # Combine: base + custom - important, then convert to frozenset
        final_stopwords = frozenset(
            (base_stopwords | custom_stopwords) - important_words
        )

        # Cache and return
        self._library_cache[language_code] = final_stopwords
        return final_stopwords

    def _get_from_libraries(self, language_code: str) -> Set[str]:
        """
        Get stopwords from libraries with fallback chain:
        For English: Use conservative DEFAULT_STOPWORDS (better for counseling domain)
        For other languages: Use library stopwords (stopwords-iso or advertools)
        """
        mapping = LANGUAGE_MAPPING.get(language_code, {})

        # For English: Use conservative DEFAULT_STOPWORDS instead of library stopwords
        # Library stopwords are too aggressive for counseling domain (filter out
        # semantically important words like "hard", "through", "get", "must", etc.)
        if language_code == "en-IN" or language_code.startswith("en-"):
            from app.core.events.event_types.similarity_based.constants import (
                DEFAULT_STOPWORDS,
            )

            return set(DEFAULT_STOPWORDS)

        # For non-English languages: Try library stopwords
        # Try stopwords-iso first (preferred for languages it supports)
        if STOPWORDS_ISO_AVAILABLE and stopwords_iso_stopwords and mapping.get("iso"):
            iso_code = mapping["iso"]
            try:
                stopwords_list = stopwords_iso_stopwords(iso_code)
                if stopwords_list:
                    return set(stopwords_list)
            except Exception as e:
                logger.debug(
                    f"stopwords-iso failed for '{iso_code}': {e}. "
                    f"Trying next fallback..."
                )

        # Fallback to vendored word lists (Tamil/Telugu/Urdu) or, when disabled,
        # the advertools-backed lookup they replace.
        if settings.VENDORED_STOPWORDS_ENABLED and mapping.get("advertools"):
            adv_lang = mapping["advertools"]
            stopwords_list = VENDORED_STOPWORDS.get(adv_lang)
            if stopwords_list:
                return set(stopwords_list)

        if ADVERTOOLS_AVAILABLE and mapping.get("advertools"):
            adv_lang = mapping["advertools"]
            if adv_lang in adv.stopwords:
                stopwords_list = adv.stopwords[adv_lang]
                if stopwords_list:
                    return set(stopwords_list)

        # Final fallback: Empty set (no stopword filtering)
        # Using English stopwords for non-English languages doesn't make sense
        # since they won't match anyway. Empty set means all tokens are
        # considered informative, which is better than incorrect filtering.
        return set()

    def clear_cache(self):
        """Clear the stopwords cache (useful for testing)."""
        self._library_cache.clear()


def get_stopwords_provider(use_multilingual: bool = True) -> StopwordsProvider:
    """
    Factory function to get the appropriate stopwords provider.

    Args:
        use_multilingual: If True, use MultilingualStopwordsProvider
                         (requires libraries).
                         If False, use DefaultStopwordsProvider
                         (backward compatible).

    Returns:
        StopwordsProvider instance
    """
    if use_multilingual and (STOPWORDS_ISO_AVAILABLE or ADVERTOOLS_AVAILABLE):
        return MultilingualStopwordsProvider()
    else:
        return DefaultStopwordsProvider()
