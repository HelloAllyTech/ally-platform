"""
Base LLM client interface.
"""

from abc import ABC, abstractmethod


class BaseLLMClient(ABC):
    """
    Abstract base class for LLM clients.

    Provides interface for language model providers.

    Language resolution and configuration is handled by resolve_config,
    so provider classes only need to handle API integration.
    """

    @property
    @abstractmethod
    def llm_instance(self):
        """
        Get the underlying LLM instance from the provider library.

        Returns:
            LLM instance (e.g., ChatOpenAI, etc.)
        """
        pass
