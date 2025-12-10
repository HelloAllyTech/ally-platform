"""Sarvam STT provider implementation."""
from typing import Optional, Dict, Any
from livekit.plugins import sarvam
from app.core.config import settings
from app.stt.base import BaseSTTClient
from app.utils.logger import get_logger

logger = get_logger(__name__)

class SarvamSTTClient(BaseSTTClient):
    """
    Sarvam STT client implementation.
    
    Uses Sarvam AI's speech-to-text service via LiveKit plugins.
    Sarvam STT accepts BCP 47 format (e.g., "en-IN", "ml-IN", "hi-IN").
    Supports Malayalam and other Indian languages.
    """
    
    # Declare language format requirement
    LANGUAGE_FORMAT = "bcp47"
    
    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        api_key: Optional[str] = None,
    ) -> None:
        """
        Initialize Sarvam STT client.
        
        Args:
            model: Sarvam model name (e.g., "saarika:v2.5")
            language_code: BCP 47 language code (e.g., "en-IN", "ml-IN", "hi-IN")
            api_key: Optional API key. If not provided, uses settings.SARVAM_API_KEY
        """
        if not model:
            raise ValueError("Sarvam STT requires 'model' parameter")
        
        if not language_code:
            raise ValueError("Sarvam STT requires 'language_code' parameter")
        
        self._model = model
        
        # Convert language code to Sarvam's required format
        self._language_code = self.convert_language_code(language_code)
        
        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.SARVAM_API_KEY
        
        if not self._api_key:
            raise ValueError("Sarvam STT requires 'api_key' parameter or SARVAM_API_KEY in settings")
        
        logger.debug(f"Creating Sarvam STT with model: {model}, language: {self._language_code} (from {language_code})")
        
        # Create the underlying STT instance
        self._stt_instance = sarvam.STT(
            model=self._model,
            language_code=self._language_code,
            api_key=self._api_key,
        )
    
    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "SarvamSTTClient":
        """
        Create Sarvam STT client from config dictionary.
        
        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "saarika:v2.5"}
            language_code: BCP 47 language code (e.g., "en-IN", "ml-IN", "hi-IN")
        
        Returns:
            SarvamSTTClient instance
        """
        # Extract model from config
        # Support both nested config structure and flat structure (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config
        
        model = config_dict.get("model", "saarika:v2.5")  # Default to saarika model
        
        return cls(
            model=model,
            language_code=language_code,
            api_key=settings.SARVAM_API_KEY,
        )
    
    @property
    def stt_instance(self) -> sarvam.STT:
        """
        Get the underlying Sarvam STT instance.
        
        Returns:
            Sarvam STT instance
        """
        return self._stt_instance

