"""LLM provider factory for creating LLM clients based on configuration."""
from typing import Optional, Dict, Any
from app.core.constants import LLMProvider, DEFAULT_LANGUAGE_CODE, DEFAULT_LLM_CONFIG
from app.core.config import settings
from app.llms.base import BaseLLMClient
from app.llms.openai import OpenAILLMClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_llm_client(
    llm_config: Optional[Dict[str, Any]] = None,
    language_code: str = DEFAULT_LANGUAGE_CODE,
) -> BaseLLMClient:
    """
    Create LLM client instance from configuration.
    
    Args:
        llm_config: Optional LLM config from metadata. If None, uses defaults.
            Expected structure: {"provider": "openai", "config": {"model": "gpt-4o-mini", "temperature": 0.7}}
            Also supports backward compatibility with flat structure: {"provider": "openai", "model": "gpt-4o-mini"}
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
        if not config_dict:
            # Backward compatibility: flat structure (model/temperature at top level)
            # Convert to nested structure for provider
            config_dict = {
                "model": llm_config.get("model", DEFAULT_LLM_CONFIG["model"]),
                "temperature": llm_config.get("temperature"),
            }
        else:
            # Ensure model has a default if missing
            if "model" not in config_dict:
                config_dict["model"] = DEFAULT_LLM_CONFIG["model"]
    
    # Map provider to class and instantiate using from_config
    provider = provider.lower()
    
    if provider == LLMProvider.OPENAI:
        return OpenAILLMClient.from_config(
            config=config_dict,
            language_code=language_code,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")

