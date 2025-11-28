"""OpenAI LLM provider implementation."""
from typing import Optional
from langchain_openai import ChatOpenAI
from app.core.config import settings
from app.utils.logger import get_logger

logger = get_logger(__name__)


def create_openai_llm(
    model: str,
    language_code: Optional[str] = None,
    temperature: Optional[float] = None,
    api_key: Optional[str] = None,
) -> ChatOpenAI:
    """
    Create OpenAI LLM instance.
    
    Args:
        model: OpenAI model name (e.g., "gpt-4o-mini", "gpt-4")
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Currently used for logging/monitoring. OpenAI infers language from prompt.
        temperature: Optional temperature setting. If not provided, uses settings.LLM_TEMPERATURE
        api_key: Optional OpenAI API key. If not provided, uses settings.OPENAI_API_KEY
    
    Returns:
        ChatOpenAI instance
    """
    if not model:
        raise ValueError("OpenAI LLM requires 'model' parameter")
    
    # Use provided temperature or fall back to settings
    temp = temperature if temperature is not None else float(settings.LLM_TEMPERATURE)
    
    # Use provided API key or fall back to settings
    api_key = api_key or settings.OPENAI_API_KEY
    
    if not api_key:
        raise ValueError("OpenAI LLM requires 'api_key' parameter or OPENAI_API_KEY in settings")
    
    # Log language code for monitoring (OpenAI doesn't require it in API calls)
    if language_code:
        logger.debug(f"Creating OpenAI LLM for language: {language_code}")
    
    return ChatOpenAI(
        model=model,
        temperature=temp,
        api_key=api_key,
    )

