"""Deepgram STT provider implementation."""
from typing import Optional
from livekit.plugins import deepgram
from app.core.config import settings
from app.core.language_config import DEFAULT_LANGUAGE_CODE
from app.utils.logger import get_logger

logger = get_logger(__name__)


def _convert_to_deepgram_language_code(language_code: str) -> str:
    """
    Convert BCP 47 language code to Deepgram's ISO 639-1 format.
    
    Deepgram uses ISO 639-1 language codes (e.g., "en", "hi") instead of 
    BCP 47 format (e.g., "en-IN", "hi-IN"). This function extracts the 
    base language code from BCP 47 format.
    
    Args:
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN", "en-US")
    
    Returns:
        ISO 639-1 language code (e.g., "en", "hi")
    
    Examples:
        "en-IN" -> "en"
        "hi-IN" -> "hi"
        "en-US" -> "en"
        "en" -> "en" (already in correct format)
    """
    # Split by hyphen and take the first part (base language code)
    # "en-IN" -> "en", "hi-IN" -> "hi"
    base_language = language_code.split("-")[0].lower()
    return base_language


def create_deepgram_stt(
    model: str,
    language_code: Optional[str] = None,
    api_key: Optional[str] = None,
) -> deepgram.STT:
    """
    Create Deepgram STT instance.
    
    Args:
        model: Deepgram model name (e.g., "nova-3", "nova-2")
        language_code: Optional BCP 47 language code (e.g., "en-IN", "hi-IN")
            Will be converted to ISO 639-1 format (e.g., "en", "hi") for Deepgram
            Defaults to DEFAULT_LANGUAGE_CODE if not provided
        api_key: Optional Deepgram API key. If not provided, uses settings.DEEPGRAM_API_KEY
    
    Returns:
        Deepgram STT instance
    """
    if not model:
        raise ValueError("Deepgram STT requires 'model' parameter")
    
    # Use default language code if not provided
    bcp47_code = language_code or DEFAULT_LANGUAGE_CODE
    
    # Convert BCP 47 to Deepgram's ISO 639-1 format
    deepgram_language = _convert_to_deepgram_language_code(bcp47_code)
    
    logger.debug(f"Converting language code: {bcp47_code} -> {deepgram_language} for Deepgram")
    
    # Use provided API key or fall back to settings
    api_key = api_key or settings.DEEPGRAM_API_KEY
    
    if not api_key:
        raise ValueError("Deepgram STT requires 'api_key' parameter or DEEPGRAM_API_KEY in settings")
    
    return deepgram.STT(
        model=model,
        language=deepgram_language,
        api_key=api_key,
    )

