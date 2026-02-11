"""Deepgram STT provider implementation."""

from typing import Any, Dict, Optional

from livekit.plugins import deepgram

from app.core.config import settings
from app.core.constants import DEFAULT_STT_CONFIG
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)


class DeepgramSTTClient(BaseSTTClient):
    """
    Deepgram STT client implementation.

    Uses Deepgram's speech-to-text service via LiveKit plugins.
    Deepgram requires ISO 639-1 format (e.g., "en", "hi").
    Language conversion is handled automatically via convert_language_code().

    Args:
        model: Deepgram model name (e.g., "nova-3", "nova-2")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
            Will be converted to ISO 639-1 format automatically
        api_key: Optional Deepgram API key. If not provided, uses
            settings.DEEPGRAM_API_KEY
    """

    # Declare language format requirement
    LANGUAGE_FORMAT = "iso6391"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format, will be converted
        api_key: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("Deepgram STT requires 'model' parameter")

        if not language_code:
            raise ValueError("Deepgram STT requires 'language_code' parameter")

        self._model = model

        # Convert language code to Deepgram's required format
        self._language_code = self.convert_language_code(language_code)

        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.DEEPGRAM_API_KEY

        if not self._api_key:
            raise ValueError(
                "Deepgram STT requires 'api_key' parameter or "
                "DEEPGRAM_API_KEY in settings"
            )

        logger.debug(
            f"Creating Deepgram STT with model: {model}, language: "
            f"{self._language_code} (from {language_code})"
        )

        # Create the underlying STT instance
        self._stt_instance = deepgram.STT(
            model=self._model,
            language=self._language_code,
            api_key=self._api_key,
        )

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "DeepgramSTTClient":
        """
        Create Deepgram STT client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "nova-3"}
                Supports both nested (from "config" key) and flat structure
                for backward compatibility
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            DeepgramSTTClient instance
        """
        # Extract model from config
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config

        model = config_dict.get("model", DEFAULT_STT_CONFIG["model"])

        return cls(
            model=model,
            language_code=language_code,
            api_key=settings.DEEPGRAM_API_KEY,
        )

    @property
    def stt_instance(self) -> deepgram.STT:
        """
        Get the underlying Deepgram STT instance.

        Returns:
            Deepgram STT instance
        """
        return self._stt_instance
