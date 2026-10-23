"""Cartesia TTS provider implementation."""

from typing import Any, Dict, Optional

from livekit.plugins import cartesia

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)


class CartesiaTTSClient(BaseTTSClient):
    """
    Cartesia TTS client implementation.

    Based on LiveKit Cartesia TTS plugin:
    https://docs.livekit.io/agents/integrations/tts/cartesia/

    Args:
        voice: Cartesia voice ID (UUID from the Cartesia voice library)
        model: Cartesia model name (e.g., "sonic-3"). Defaults to "sonic-3".
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN"). Cartesia
            expects a bare ISO 639-1 code (e.g. "en", "hi"), so the region
            subtag is stripped.
        speed: Optional speed control (float, or one of Cartesia's named
            presets: "slowest", "slow", "normal", "fast", "fastest")
        emotion: Optional emotion control (e.g., "positivity:high")
        api_key: Optional API key (defaults to settings.CARTESIA_API_KEY)
    """

    def __init__(
        self,
        voice: str,
        model: Optional[str] = None,
        language_code: Optional[str] = None,
        speed: Optional[Any] = None,
        emotion: Optional[Any] = None,
        api_key: Optional[str] = None,
    ):
        super().__init__()
        if not voice:
            raise ValueError("Cartesia TTS requires 'voice'")

        self._voice = voice
        self._model = model or "sonic-3"
        self._language_code = language_code
        self._speed = speed
        self._emotion = emotion
        self._api_key = api_key or settings.CARTESIA_API_KEY
        self._tts_instance = None

    @staticmethod
    def validate_voice(voice: str) -> bool:
        """
        Validate Cartesia TTS configuration.

        Structural check only (non-empty voice id) — no live API call is made
        from __init__/from_config, matching every other provider in this
        package (see docs/05-tts-providers.md, "Constructor validation is
        structural only").

        Args:
            voice: Cartesia voice ID

        Returns:
            True if validation succeeds, False otherwise
        """
        if not voice or not isinstance(voice, str) or not voice.strip():
            logger.error(f"Invalid Cartesia voice id: '{voice}'")
            return False
        return True

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "CartesiaTTSClient":
        """
        Create Cartesia TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"voice": "<voice-uuid>", "model": "sonic-3"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            CartesiaTTSClient instance
        """
        voice = config.get("voice")
        if not voice:
            raise ValueError("Cartesia TTS requires 'voice' in config")

        return cls(
            voice=voice,
            model=config.get("model"),
            language_code=language_code,
            speed=config.get("speed"),
            emotion=config.get("emotion"),
            api_key=settings.CARTESIA_API_KEY,
        )

    def allows_clip_synthesis(self) -> bool:
        """Cartesia voices are fixed speakers (a voice id, not a prompt), so a
        clip is the same voice as the reply."""
        return True

    @property
    def tts_instance(self) -> "cartesia.TTS":
        """Get the underlying Cartesia TTS instance."""
        if self._tts_instance is None:
            language = (self._language_code or "en").split("-")[0]
            self._tts_instance = cartesia.TTS(
                model=self._model,
                voice=self._voice,
                language=language,
                speed=self._speed,
                emotion=self._emotion,
                api_key=self._api_key,
                # Cartesia only supports word-level timestamps for en/de/es/fr
                # on `sonic` models (all other languages, e.g. hi, fall back
                # to degraded alignment/synthesis quality if requested — see
                # https://docs.cartesia.ai/api-reference/tts/compare-tts-endpoints).
                # The streaming path defaults this True and nothing in this
                # codebase consumes word timestamps, so disable it outright
                # rather than only for the unsupported languages.
                word_timestamps=False,
            )
            self._wrap_stream_with_timeout(self._tts_instance)
        return self._tts_instance
