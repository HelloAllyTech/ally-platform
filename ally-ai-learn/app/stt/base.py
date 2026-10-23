"""
Base STT client interface.
"""

from abc import ABC, abstractmethod
from typing import Literal


class BaseSTTClient(ABC):
    """
    Abstract base class for STT clients.

    Provides interface for speech-to-text providers.
    Subclasses should set LANGUAGE_FORMAT class attribute to declare
    their language code format requirement.

    Language resolution and configuration is handled by resolve_config,
    so provider classes only need to handle API integration.
    """

    # Subclasses must declare their language format requirement
    LANGUAGE_FORMAT: Literal["bcp47", "iso6391"] = "bcp47"

    @property
    @abstractmethod
    def stt_instance(self):
        """
        Get the underlying STT instance from the provider library.

        Returns:
            STT instance (e.g., deepgram.STT, etc.)
        """
        pass

    @classmethod
    def convert_language_code(cls, language_code: str) -> str:
        """
        Convert BCP 47 language code to this provider's required format.

        Uses the LANGUAGE_FORMAT class attribute to determine conversion.

        Args:
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            Language code in provider's required format
        """
        if cls.LANGUAGE_FORMAT == "iso6391":
            # Extract base language code: "en-IN" -> "en"
            return language_code.split("-")[0].lower()
        else:  # bcp47
            # Return as-is
            return language_code
