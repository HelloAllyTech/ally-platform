"""
Base LLM client interface.
"""

from abc import ABC, abstractmethod
from typing import Any, List


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

    async def achat(self, messages: List[Any]) -> Any:
        """
        Async chat - invokes the underlying LLM with messages.
        Returns a message-like object with .content (e.g. LangChain AIMessage).
        """
        return await self.llm_instance.ainvoke(messages)
