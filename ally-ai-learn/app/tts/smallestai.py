"""Smallest.ai TTS provider implementation."""

from typing import Any, Dict, Optional

from livekit.plugins import smallestai

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)

# livekit-plugins-smallestai is pinned to 1.3.12 (matching this repo's
# livekit-agents pin) and its default base_url at that version is the old
# "https://waves-api.smallest.ai/api/v1" host. Smallest.ai has since moved
# their Waves API to "https://api.smallest.ai/waves/v1" (per their current
# docs) — passed explicitly here rather than relying on the pinned plugin's
# stale default.
_SMALLEST_BASE_URL = "https://api.smallest.ai/waves/v1"


class SmallestAITTSClient(BaseTTSClient):
    """
    Smallest.ai TTS client implementation.

    Based on LiveKit Smallest.ai TTS plugin:
    https://docs.livekit.io/agents/integrations/tts/smallestai/

    Args:
        voice_id: Smallest.ai voice id (e.g., "emily")
        model: Smallest.ai model name. Defaults to "lightning_v3.1_pro".
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN").
            Smallest.ai expects a bare ISO 639-1 code (e.g. "en", "hi"), so
            the region subtag is stripped.
        speed: Optional speed multiplier (Smallest.ai default is 1.0)
        api_key: Optional API key (defaults to settings.SMALLEST_API_KEY)
    """

    def __init__(
        self,
        voice_id: str,
        model: Optional[str] = None,
        language_code: Optional[str] = None,
        speed: Optional[float] = None,
        api_key: Optional[str] = None,
    ):
        super().__init__()
        if not voice_id:
            raise ValueError("Smallest.ai TTS requires 'voice_id'")

        self._voice_id = voice_id
        self._model = model or "lightning_v3.1_pro"
        self._language_code = language_code
        self._speed = speed
        self._api_key = api_key or settings.SMALLEST_API_KEY
        self._tts_instance = None

    @staticmethod
    def validate_voice(voice_id: str) -> bool:
        """
        Validate Smallest.ai TTS configuration.

        Structural check only (non-empty voice id) — no live API call is made
        from __init__/from_config, matching every other provider in this
        package (see docs/05-tts-providers.md, "Constructor validation is
        structural only").

        Args:
            voice_id: Smallest.ai voice id

        Returns:
            True if validation succeeds, False otherwise
        """
        if not voice_id or not isinstance(voice_id, str) or not voice_id.strip():
            logger.error(f"Invalid Smallest.ai voice_id: '{voice_id}'")
            return False
        return True

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "SmallestAITTSClient":
        """
        Create Smallest.ai TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"voice_id": "emily", "model": "lightning_v3.1_pro"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            SmallestAITTSClient instance
        """
        voice_id = config.get("voice_id")
        if not voice_id:
            raise ValueError("Smallest.ai TTS requires 'voice_id' in config")

        return cls(
            voice_id=voice_id,
            model=config.get("model"),
            language_code=language_code,
            speed=config.get("speed"),
            api_key=settings.SMALLEST_API_KEY,
        )

    @property
    def tts_instance(self) -> "smallestai.TTS":
        """Get the underlying Smallest.ai TTS instance."""
        if self._tts_instance is None:
            kwargs: Dict[str, Any] = {
                "model": self._model,
                "voice_id": self._voice_id,
                "language": (self._language_code or "en").split("-")[0],
                "api_key": self._api_key,
                "base_url": _SMALLEST_BASE_URL,
            }
            if self._speed is not None:
                kwargs["speed"] = self._speed
            self._tts_instance = smallestai.TTS(**kwargs)
            self._wrap_stream_with_timeout(self._tts_instance)
        return self._tts_instance
