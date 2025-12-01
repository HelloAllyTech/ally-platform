"""LLM provider factory for creating LLM clients based on configuration."""
from typing import Optional, Dict, Any
from app.core.constants import LLMProvider
from app.core.language.factory import resolve_config
from app.llms.base import BaseLLMClient
from app.llms.openai import OpenAILLMClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_llm_client(
    language_code: str,
    override_config: Optional[Dict[str, Any]] = None,
) -> BaseLLMClient:
    """
    Create LLM client instance from configuration.
    
    This function uses resolve_config to resolve configuration and then
    instantiates the appropriate provider class.
    
    Configuration includes:
    - language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    - override_config: Optional provider/model/config overrides
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        override_config: Optional override configuration dict with:
            - provider: LLM provider name (e.g., "openai")
            - model: Model name (e.g., "gpt-4o-mini")
            - temperature: Optional temperature setting
            - config: Additional provider-specific config dict (e.g., {"api_key": "..."})
    
    Returns:
        LLM client instance
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Resolve configuration from registry
    config = resolve_config("llm", language_code, override_config)
    
    # Map provider to class and instantiate
    provider = config["provider"].lower()
    
    if provider == LLMProvider.OPENAI:
        # Extract temperature and api_key from resolved config
        # Temperature comes from override_config (handled by resolve_config)
        temperature = config.get("temperature")
        api_key = config.get("api_key")
        
        return OpenAILLMClient(
            model=config["model"],
            language_code=config["language_code"],  # BCP 47
            temperature=temperature,
            api_key=api_key,
        )
    else:
        raise ValueError(f"Unsupported LLM provider: {provider}")

