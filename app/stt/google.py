"""Google Cloud STT provider implementation."""

from typing import Any, Dict, Optional

from livekit.plugins import google

from app.core.constants import GoogleSTTConfig
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)


class GoogleSTTClient(BaseSTTClient):
    """
    Google Cloud STT client implementation.

    Uses Google Cloud Speech-to-Text service via LiveKit plugins.
    Google STT accepts BCP 47 format (e.g., "en-IN", "ml-IN").
    Supports Malayalam and other Indian languages.

    Args:
        model: Google STT model name. Valid values:
            - "chirp" (default, recommended, see LiveKit docs:
              https://docs.livekit.io/agents/models/stt/plugins/google/)
            - "chirp_2", "chirp_3" (may have location compatibility
              issues)
            - "latest_long" (for long audio)
            - "latest_short" (for short audio)
            - "long", "short"
            - Or omit to use GoogleSTTConfig.DEFAULT_MODEL as default
        language_code: BCP 47 language code (e.g., "en-IN", "ml-IN",
            "hi-IN")
        credentials_info: Optional dict of Google Cloud credentials
        credentials_file: Optional path to credentials JSON file
        location: Optional Google Cloud location/region (e.g.,
            "asia-northeast1", "asia-southeast1", "global")
            Defaults to GoogleSTTConfig.DEFAULT_LOCATION. Some models
            like "chirp_2" may only be available in specific regions.
    """

    # Declare language format requirement
    LANGUAGE_FORMAT = "bcp47"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format
        credentials_info: Optional[dict] = None,
        credentials_file: Optional[str] = None,
        location: Optional[str] = None,
    ) -> None:
        if not language_code:
            raise ValueError("Google STT requires 'language_code' parameter")

        # Map common model names to valid model names
        # According to LiveKit docs, "chirp" is a recommended model
        # Use "chirp" as the default model (chirp_2 has location compatibility issues)
        if model:
            self._model = GoogleSTTConfig.MODEL_MAPPING.get(model.lower(), model)
        else:
            # If no model specified, use default from config
            self._model = GoogleSTTConfig.DEFAULT_MODEL
        self._language_code = self.convert_language_code(language_code)

        # Use provided credentials or fall back to environment
        self._credentials_info = credentials_info
        self._credentials_file = credentials_file
        self._location = location  # Store location for use in STT kwargs

        logger.debug(
            f"Creating Google STT with model: {self._model}, language: "
            f"{self._language_code} (from {language_code})"
        )

        stt_kwargs = {
            "languages": self._language_code,
            # From config constant
            "spoken_punctuation": GoogleSTTConfig.SPOKEN_PUNCTUATION,
        }

        # Always set model (defaults to GoogleSTTConfig.DEFAULT_MODEL if not specified)
        stt_kwargs["model"] = self._model

        # Set location if provided (some models like chirp_2 may only be
        # available in specific regions)
        # If not provided, defaults to GoogleSTTConfig.DEFAULT_LOCATION
        # ("global")
        if self._location:
            stt_kwargs["location"] = self._location
            logger.debug(f"Using location: {self._location}")
        else:
            # Use default location from config
            stt_kwargs["location"] = GoogleSTTConfig.DEFAULT_LOCATION

        if credentials_info:
            stt_kwargs["credentials_info"] = credentials_info
        elif credentials_file:
            stt_kwargs["credentials_file"] = credentials_file

        self._stt_instance = google.STT(**stt_kwargs)

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "GoogleSTTClient":
        """
        Create Google STT client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "chirp"}  # Model is optional, defaults to
                GoogleSTTConfig.DEFAULT_MODEL
                Valid models: "chirp" (default, recommended), "chirp_2",
                "chirp_3", "latest_long", "latest_short", "long", "short"
                Can optionally include: {"location": "asia-northeast1",
                "credentials_file": "...", "credentials_info": {...},
                "language_code": "pa-Guru-IN"}  # language_code in config
                takes priority over parameter
                Note: Some models like "chirp_2" may only be available in
                specific regions (e.g., "asia-southeast1")
            language_code: BCP 47 language code (e.g., "en-IN", "ml-IN", "hi-IN")
                Used as fallback if not specified in config

        Returns:
            GoogleSTTClient instance
        """
        # Extract model from config
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            # Backward compatibility: treat entire config as flat structure
            config_dict = config

        # Model is optional - if not specified, will use
        # GoogleSTTConfig.DEFAULT_MODEL as default.
        model = config_dict.get("model")

        # Extract optional credentials and location from config
        credentials_info = config_dict.get("credentials_info")
        credentials_file = config_dict.get("credentials_file")
        location = config_dict.get("location")

        # Prioritize language_code from config if available, otherwise use parameter
        # This allows per-scenario language code overrides
        final_language_code = config.get("languageCode") or language_code

        return cls(
            model=model,
            language_code=final_language_code,
            credentials_info=credentials_info,
            credentials_file=credentials_file,
            location=location,
        )

    @property
    def stt_instance(self) -> google.STT:
        """
        Get the underlying Google STT instance.

        Returns:
            Google STT instance
        """
        return self._stt_instance
