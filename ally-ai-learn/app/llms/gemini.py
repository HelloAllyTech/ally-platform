"""Google Gemini LLM provider implementation."""

import re
from typing import Any, Dict, Optional

from langchain_google_genai import ChatGoogleGenerativeAI

from app.core.config import settings
from app.core.logger import get_logger
from app.llms.base import BaseLLMClient

logger = get_logger(__name__)


def is_gemini_3_or_later(model: Optional[str]) -> bool:
    """Gemini 3 onwards: Google deprecated custom sampling (temperature, top_p,
    top_k) and thinking_budget, and models after Gemini 3 reject them with a
    400. The ``-latest`` aliases count because they move to the newest model
    without the id changing."""
    if not model:
        return False
    name = model.strip().lower().removeprefix("models/")
    if not name.startswith("gemini-"):
        return False
    if name.endswith("-latest"):
        return True
    match = re.match(r"^gemini-(\d+)", name)
    return bool(match) and int(match.group(1)) >= 3


class GeminiLLMClient(BaseLLMClient):
    """
    Google Gemini LLM client implementation.

    Uses Google's Gemini language models via LangChain.
    Gemini accepts BCP 47 format directly (used for logging/monitoring).
    Language is inferred from the prompt content.

    Args:
        model: Gemini model name (e.g., "gemini-2.0-flash-exp", "gemini-1.5-pro")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN",
            "ml-IN")
            Used for logging/monitoring. Gemini infers language from
            prompt.
        temperature: Optional temperature setting. If not provided,
            uses settings.LLM_TEMPERATURE
        api_key: Optional Google API key. If not provided, uses
            settings.GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
            environment variable
    """

    PROVIDER = "gemini"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        temperature: Optional[float] = None,
        api_key: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("Gemini LLM requires 'model' parameter")

        if not language_code:
            raise ValueError("Gemini LLM requires 'language_code' parameter")

        self._model = model
        self._language_code = language_code

        # Use provided temperature or fall back to settings. Gemini 3+ takes
        # none at all, so neither the override nor the settings default applies.
        self._sends_temperature = not is_gemini_3_or_later(model)
        self._temperature = (
            (
                temperature
                if temperature is not None
                else float(settings.LLM_TEMPERATURE)
            )
            if self._sends_temperature
            else None
        )

        # Use provided API key or fall back to settings
        # Gemini can use either GOOGLE_API_KEY or GOOGLE_APPLICATION_CREDENTIALS
        self._api_key = api_key or settings.GOOGLE_API_KEY

        if not self._api_key and not settings.GOOGLE_APPLICATION_CREDENTIALS:
            raise ValueError(
                "Gemini LLM requires 'api_key' parameter, GOOGLE_API_KEY in settings, "
                "or GOOGLE_APPLICATION_CREDENTIALS environment variable"
            )

        logger.debug(
            f"Creating Gemini LLM with model: {model}, language: {language_code}"
        )

        # Create the underlying LLM instance
        # ChatGoogleGenerativeAI will use GOOGLE_APPLICATION_CREDENTIALS if
        # google_api_key is None
        llm_kwargs = {
            "model": self._model,
            # Stream tokens to TTS via the LLMAdapter when enabled (see
            # settings.STREAM_RESPONSE). Default False keeps current behavior.
            "streaming": settings.STREAM_RESPONSE,
        }

        # Only pass google_api_key if we have one, otherwise let it use
        # GOOGLE_APPLICATION_CREDENTIALS
        if self._api_key:
            llm_kwargs["google_api_key"] = self._api_key

        if self._sends_temperature:
            llm_kwargs["temperature"] = self._temperature

        self._llm_instance = ChatGoogleGenerativeAI(**llm_kwargs)
        if not self._sends_temperature:
            # langchain-google-genai 2.x declares `temperature: float = 0.7` and
            # sends it on every request; its request builder drops None fields,
            # so clearing it after construction is the only way to omit it.
            self._llm_instance.temperature = None

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "GeminiLLMClient":
        """
        Create Gemini LLM client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "gemini-2.0-flash-exp", "temperature": 0.7}
                Supports both nested (from "config" key) and flat structure
                for backward compatibility
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN", "ml-IN")

        Returns:
            GeminiLLMClient instance
        """
        # Extract model and temperature from config
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config

        # Default Gemini model if not specified
        default_model = config_dict.get("model", "gemini-2.0-flash-exp")
        temperature = config_dict.get("temperature")

        return cls(
            model=default_model,
            language_code=language_code,
            temperature=temperature,
            api_key=settings.GOOGLE_API_KEY,
        )

    @property
    def llm_instance(self) -> ChatGoogleGenerativeAI:
        """
        Get the underlying Gemini LLM instance.

        Returns:
            ChatGoogleGenerativeAI instance
        """
        return self._llm_instance
