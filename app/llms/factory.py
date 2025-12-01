"""LLM provider factory for creating LLM clients based on configuration."""
from app.core.constants import LLMProvider
from app.core.language.factory import resolve_config
from app.llms.base import BaseLLMClient
from app.llms.openai import OpenAILLMClient
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_llm_client(
    language_code: str,
) -> BaseLLMClient:
    """
    Create LLM client instance from configuration.
    
    This function uses resolve_config to resolve configuration from language registry
    and then instantiates the appropriate provider class.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
    
    Returns:
        LLM client instance
    
    Raises:
        ValueError: If provider is unsupported or required parameters are missing
    """
    # Resolve configuration from language registry
    config = resolve_config("llm", language_code)
    
    # Map provider to class and instantiate
    provider = config["provider"].lower()
    
    if provider == LLMProvider.OPENAI:
        # Extract temperature and api_key from resolved config
        # Temperature defaults to None (not set in language registry)
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

