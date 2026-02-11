"""LLM provider factory for creating LLM clients based on configuration."""

from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, DEFAULT_LLM_CONFIG, LLMProvider
from app.core.logger import get_logger
from app.llms.base import BaseLLMClient
from app.llms.gemini import GeminiLLMClient
from app.llms.openai import OpenAILLMClient

logger = get_logger(__name__)


def create_llm_client(
    llm_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> BaseLLMClient:
    """
    Create LLM client instance from configuration.

    Args:
        llm_config: Optional LLM config from metadata. If None, uses defaults.
            Expected structure: {"provider": "openai", "config":
            {"model": "gpt-4o-mini", "temperature": 0.7}}
            Also supports backward compatibility with flat structure:
            {"provider": "openai", "model": "gpt-4o-mini"}
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

    Returns:
        LLM client instance

    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Use provided config or fallback to defaults
    if llm_config is None:
        logger.debug("No LLM config provided, using defaults")
        provider = DEFAULT_LLM_CONFIG["provider"]
        # Create default config dict for provider to parse
        config_dict = {"model": DEFAULT_LLM_CONFIG["model"]}
    else:
        provider = llm_config.get("provider", DEFAULT_LLM_CONFIG["provider"])
        # Support both nested config structure and backward-compatible flat structure
        config_dict = llm_config.get("config", {})
        is_local_provider = provider.lower() in (LLMProvider.OLLAMA, LLMProvider.VLLM)
        if not config_dict:
            # Backward compatibility: flat structure (model/temperature at top level)
            # Convert to nested structure for provider
            default_model = (
                None
                if is_local_provider
                else llm_config.get("model", DEFAULT_LLM_CONFIG["model"])
            )
            config_dict = {
                "temperature": llm_config.get("temperature"),
            }
            if default_model:
                config_dict["model"] = default_model
        else:
            # Ensure model has a default if missing (not for local providers)
            if "model" not in config_dict and not is_local_provider:
                config_dict["model"] = DEFAULT_LLM_CONFIG["model"]

    # Map provider to class and instantiate using from_config
    provider = provider.lower()
    logger.info(f"Creating LLM client with provider: {provider}, config: {config_dict}")

    if provider == LLMProvider.OPENAI:
        return OpenAILLMClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == LLMProvider.GEMINI or provider == "google":
        # Support both "gemini" and "google" as provider names
        return GeminiLLMClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == LLMProvider.OLLAMA:
        base_url = config_dict.get("base_url") or settings.OLLAMA_BASE_URL
        if not base_url:
            logger.warning(
                "OLLAMA_BASE_URL not set in environment or config. "
                "Using default: http://host.docker.internal:11434/v1"
            )
            base_url = (
                settings.OLLAMA_BASE_URL or "http://host.docker.internal:11434/v1"
            )
        if settings.LOCAL_LLM_MODEL and "model" not in config_dict:
            config_dict["model"] = settings.LOCAL_LLM_MODEL
            logger.info(
                f"Using LOCAL_LLM_MODEL from settings: {settings.LOCAL_LLM_MODEL}"
            )
        config_dict["base_url"] = base_url
        logger.info(
            f"Creating Ollama LLM client with model: {config_dict.get('model')}, "
            f"base_url: {base_url}"
        )
        return OpenAILLMClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    elif provider == LLMProvider.VLLM:
        base_url = config_dict.get("base_url") or settings.VLLM_BASE_URL
        if not base_url:
            raise ValueError(
                "vLLM provider requires VLLM_BASE_URL environment variable or "
                "base_url in config"
            )
        if settings.LOCAL_LLM_MODEL and "model" not in config_dict:
            config_dict["model"] = settings.LOCAL_LLM_MODEL
        config_dict["base_url"] = base_url
        return OpenAILLMClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")
