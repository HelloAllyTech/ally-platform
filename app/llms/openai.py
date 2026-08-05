"""OpenAI LLM provider implementation."""

from typing import Any, Dict, Optional

from langchain_openai import ChatOpenAI

from app.core.config import settings
from app.core.constants import DEFAULT_LLM_CONFIG
from app.core.logger import get_logger
from app.llms.base import BaseLLMClient

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

    PROVIDER = "openai"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        temperature: Optional[float] = None,
        api_key: Optional[str] = None,
        base_url: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("OpenAI LLM requires 'model' parameter")

        if not language_code:
            raise ValueError("OpenAI LLM requires 'language_code' parameter")

        self._model = model
        self._language_code = language_code
        self._base_url = base_url

        # Use provided temperature or fall back to settings
        self._temperature = (
            temperature if temperature is not None else float(settings.LLM_TEMPERATURE)
        )

        # Use provided API key or fall back to settings
        # When base_url is set (e.g. Ollama/vLLM), use a placeholder if no real key
        self._api_key = api_key or settings.OPENAI_API_KEY
        if not self._api_key:
            if base_url:
                self._api_key = "not-needed"
            else:
                raise ValueError(
                    "OpenAI LLM requires 'api_key' parameter "
                    "or OPENAI_API_KEY in settings"
                )

        logger.debug(
            f"Creating OpenAI LLM with model: {model}, language: {language_code}"
            + (f", base_url: {base_url}" if base_url else "")
        )

        # Create the underlying LLM instance.
        # timeout/max_retries cap the worst-case duration of any single LLM
        # call. Without these, openai-python defaults to 600s timeout and 2
        # retries, so a slow OpenAI response can hang the agent for many
        # minutes, manifesting as a "stuck thinking" freeze for the user.
        chat_kwargs: Dict[str, Any] = {
            "model": self._model,
            "temperature": self._temperature,
            "api_key": self._api_key,
            "timeout": 30,
            "max_retries": 1,
            # When enabled, ainvoke() streams tokens (via callbacks) so the
            # LLMAdapter's stream_mode="messages" forwards them to TTS as they
            # arrive — TTS starts on the first token instead of the full reply.
            "streaming": settings.STREAM_RESPONSE,
            # Streamed OpenAI responses carry NO usage metadata unless the
            # stream_options include_usage flag is set — without this, every
            # agent turn's usage extraction returned None, so llm_usage had
            # no agent_turn rows (cost dashboard blind spot) and the
            # [PROMPT_CACHE] hit-rate log never fired. Adds one final usage
            # chunk to the stream; no effect on token latency or cost.
            "stream_usage": True,
        }
        if self._base_url:
            chat_kwargs["base_url"] = self._base_url

        self._llm_instance = ChatOpenAI(**chat_kwargs)

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
        base_url = config_dict.get("base_url")

        return cls(
            model=model,
            language_code=language_code,
            temperature=temperature,
            api_key=settings.OPENAI_API_KEY,
            base_url=base_url,
        )

    @property
    def llm_instance(self) -> ChatOpenAI:
        """
        Get the underlying OpenAI LLM instance.

        Returns:
            ChatOpenAI instance
        """
        return self._llm_instance
