"""OpenAI LLM provider implementation."""

from typing import Any, Dict, Optional

from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.constants import DEFAULT_LLM_CONFIG
from app.llms.base import BaseLLMClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


class OpenAILLMClient(BaseLLMClient):
    """
    OpenAI LLM client implementation.

    Uses OpenAI's language models via LangChain.
    OpenAI accepts BCP 47 format directly (used for logging/monitoring).
    Language is inferred from the prompt content.

    Args:
        model: OpenAI model name (e.g., "gpt-4o-mini", "gpt-4")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
            Used for logging/monitoring. OpenAI infers language from
            prompt.
        temperature: Optional temperature setting. If not provided,
            uses settings.LLM_TEMPERATURE
        api_key: Optional OpenAI API key. If not provided, uses
            settings.OPENAI_API_KEY
    """

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        temperature: Optional[float] = None,
        api_key: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("OpenAI LLM requires 'model' parameter")

        if not language_code:
            raise ValueError("OpenAI LLM requires 'language_code' parameter")

        self._model = model
        self._language_code = language_code

        # Use provided temperature or fall back to settings
        self._temperature = (
            temperature if temperature is not None else float(settings.LLM_TEMPERATURE)
        )

        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.OPENAI_API_KEY

        if not self._api_key:
            raise ValueError(
                "OpenAI LLM requires 'api_key' parameter or OPENAI_API_KEY in settings"
            )

        logger.debug(
            f"Creating OpenAI LLM with model: {model}, language: {language_code}"
        )

        # Create the underlying LLM instance
        self._llm_instance = ChatOpenAI(
            model=self._model,
            temperature=self._temperature,
            api_key=self._api_key,
        )

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "OpenAILLMClient":
        """
        Create OpenAI LLM client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "gpt-4o-mini", "temperature": 0.7}
                Supports both nested (from "config" key) and flat structure
                for backward compatibility
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            OpenAILLMClient instance
        """
        # Extract model and temperature from config
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config

        model = config_dict.get("model", DEFAULT_LLM_CONFIG["model"])
        temperature = config_dict.get("temperature")

        return cls(
            model=model,
            language_code=language_code,
            temperature=temperature,
            api_key=settings.OPENAI_API_KEY,
        )

    @property
    def llm_instance(self) -> ChatOpenAI:
        """
        Get the underlying OpenAI LLM instance.

        Returns:
            ChatOpenAI instance
        """
        return self._llm_instance
