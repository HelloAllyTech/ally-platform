"""
Factory for creating language-specific text processors.
"""

from typing import Dict

from app.core.constants import DEFAULT_LANGUAGE_CODE
from app.core.events.event_types.similarity_based.text_processor import (
    TextProcessor,
    UnifiedTextProcessor,
)


class TextProcessorFactory:
    """Factory for creating language-aware text processors."""

    # Cache instances (one per language_code)
    _instances: Dict[str, TextProcessor] = {}

    @classmethod
    def get_processor(cls, language_code: str = DEFAULT_LANGUAGE_CODE) -> TextProcessor:
        """
        Get or create a text processor for the given language.

        For now, returns UnifiedTextProcessor for all languages.
        In the future, can return specialized processors for edge cases.

        Args:
            language_code: Language code (e.g., "en-IN", "hi-IN")

        Returns:
            TextProcessor instance
        """
        # Check cache
        if language_code in cls._instances:
            return cls._instances[language_code]

        # For now, use unified processor for all languages
        # Future: Can add specialized processors for edge cases
        try:
            processor = UnifiedTextProcessor(language_code=language_code)
        except Exception as e:
            # If UnifiedTextProcessor fails, log and create a fallback
            import logging

            logger = logging.getLogger(__name__)
            logger.error(
                f"Failed to create UnifiedTextProcessor for "
                f"'{language_code}': {e}, using default '{DEFAULT_LANGUAGE_CODE}'"
            )
            # Fallback to English if language-specific processor fails
            if language_code != DEFAULT_LANGUAGE_CODE:
                processor = UnifiedTextProcessor(language_code=DEFAULT_LANGUAGE_CODE)
            else:
                # If even English fails, raise the exception
                raise

        # Cache instance
        cls._instances[language_code] = processor

        # Ensure we never return None
        assert (
            processor is not None
        ), f"TextProcessorFactory.get_processor('{language_code}') returned None"
        return processor

    @classmethod
    def register_processor(cls, language_code: str, processor: TextProcessor):
        """
        Register a custom processor (for testing or edge cases).

        Args:
            language_code: Language code to register for
            processor: TextProcessor instance
        """
        cls._instances[language_code] = processor

    @classmethod
    def clear_cache(cls):
        """Clear the processor cache (useful for testing)."""
        cls._instances.clear()
