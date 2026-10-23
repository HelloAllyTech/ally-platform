"""LLM provider factory for creating LLM clients based on configuration."""

from typing import Any, Dict, Optional

from app.core.config import settings
from app.core.constants import DEFAULT_LANGUAGE_CODE, DEFAULT_LLM_CONFIG, LLMProvider
from app.core.logger import get_logger
from app.llms.base import BaseLLMClient
from app.llms.gemini import GeminiLLMClient, is_gemini_3_or_later
from app.llms.openai import OpenAILLMClient

logger = get_logger(__name__)


def infer_provider_from_model(model: Optional[str]) -> Optional[str]:
    """Infer the LLM provider from a model name.

    Prompt/skill rows store only a model string (no provider), and the voice
    runtime supports OpenAI + Gemini. Map by well-known prefixes so a
    prompt-level model override also selects the right client class. Returns
    None when the prefix is unrecognized (caller keeps the existing provider).
    """
    if not model:
        return None
    name = model.strip().lower()
    if name.startswith(("gemini", "google")):
        return LLMProvider.GEMINI
    if name.startswith(("gpt", "o1", "o3", "o4", "chatgpt", "text-", "davinci")):
        return LLMProvider.OPENAI
    return None


def model_supports_temperature(model: Optional[str]) -> bool:
    """Whether a model accepts a custom ``temperature``.

    OpenAI reasoning models (o-series, gpt-5 family) only allow the default and
    return a 400 for any other value; Gemini 3+ deprecated custom sampling. Return
    False for those so callers can drop the override instead of failing the call.
    Unknown/None models default True.
    """
    if not model:
        return True
    name = model.strip().lower()
    return not (
        name.startswith(("o1", "o3", "o4", "gpt-5")) or is_gemini_3_or_later(name)
    )


def create_llm_client(
    llm_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
    temperature: Optional[float] = None,
    model: Optional[str] = None,
    provider_override: Optional[str] = None,
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
        temperature: Optional roleplay-level temperature override. When provided
            (i.e. set on the scenario's promptData), it takes precedence over any
            temperature in ``llm_config`` and over the global LLM_TEMPERATURE
            default. None leaves the existing provider/global resolution intact.

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

    # Roleplay-level override: when the scenario's promptData specifies a
    # temperature, it wins over any temperature carried in llm_config and over
    # the per-provider fallback to settings.LLM_TEMPERATURE. Applied here (after
    # config_dict is finalized for every provider branch) so it lands in the
    # single dict that from_config reads.
    if temperature is not None:
        config_dict["temperature"] = temperature

    # Prompt-level model override: when a prompt/skill specifies a model, it
    # wins over the model carried in llm_config and the code default. The
    # provider is re-derived from the model name (prompts store only a model
    # string), so the correct client class is built. An unrecognized model
    # keeps the existing provider.
    if model:
        config_dict["model"] = model

    # Provider resolution: an explicit prompt-level provider wins; otherwise
    # infer from an overriding model name (legacy heuristic, kept as fallback).
    if provider_override:
        provider = provider_override
    elif model:
        inferred_provider = infer_provider_from_model(model)
        if inferred_provider:
            provider = inferred_provider

    # Some models (OpenAI reasoning: o-series, gpt-5) reject a custom temperature
    # and 400 on any non-default value. Drop it so an override on such a model
    # degrades to the model's default instead of breaking the call.
    if "temperature" in config_dict and not model_supports_temperature(
        config_dict.get("model")
    ):
        logger.info(
            "Model %s does not support a custom temperature; omitting it.",
            config_dict.get("model"),
        )
        config_dict.pop("temperature", None)

    # Map provider to class and instantiate using from_config
    provider = provider.lower()

    # No OpenAI key configured: redirect every OpenAI-provider role (conversation,
    # branching, chat-summary, ...) to the local Ollama server instead of failing.
    # Centralized here so no caller/DEFAULT_*_CONFIG needs its own fallback logic.
    if provider == LLMProvider.OPENAI and not settings.OPENAI_API_KEY:
        if settings.OLLAMA_BASE_URL:
            logger.warning(
                "OPENAI_API_KEY not set; falling back to Ollama at %s for "
                "this LLM call.",
                settings.OLLAMA_BASE_URL,
            )
            provider = LLMProvider.OLLAMA
            # config_dict may already carry DEFAULT_LLM_CONFIG's OpenAI model
            # name (e.g. "gpt-4o-mini") from the resolution above — that model
            # doesn't exist on Ollama. Drop it so the Ollama branch below falls
            # through to LOCAL_LLM_MODEL (or its own default) instead of 404ing.
            if config_dict.get("model") == DEFAULT_LLM_CONFIG["model"]:
                config_dict.pop("model", None)
        else:
            raise ValueError(
                "No OPENAI_API_KEY and no OLLAMA_BASE_URL configured — set one of "
                "them to run the LLM (see docs/07-llm-providers.md)."
            )

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
