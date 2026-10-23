"""ElevenLabs (Scribe) STT provider implementation."""

from typing import Any, Dict, Optional

from livekit.plugins import elevenlabs

from app.core.config import settings
from app.core.logger import get_logger
from app.stt.base import BaseSTTClient

logger = get_logger(__name__)

# Only the realtime model supports streaming transcription, which is what the
# live agent path requires. The plugin defaults to "scribe_v1" (batch only),
# so we must default to the realtime model here.
DEFAULT_ELEVENLABS_STT_MODEL = "scribe_v2_realtime"

# Seconds of silence before the realtime model commits a final transcript. The
# plugin default (1.5 s) put ~1.9 s between the learner stopping and the final
# arriving, and the turn can't end before the final does. Committing early is
# safe: a mid-sentence pause just yields two finals, and the turn detector
# still decides when the learner is done. Measured 2026-10-22: ~0.8-0.9 s.
COMMIT_SILENCE_S = 0.5


class ElevenLabsSTTClient(BaseSTTClient):
    """
    ElevenLabs (Scribe) STT client implementation.

    Uses ElevenLabs' Scribe speech-to-text service via LiveKit plugins.
    ElevenLabs accepts ISO 639-1 language codes (e.g., "en", "hi", "ml", "kn"),
    so BCP 47 codes are converted automatically via convert_language_code().

    Only "scribe_v2_realtime" supports streaming, which is required for live
    agent turns; "scribe_v1" and "scribe_v2" are batch-only and will not
    stream interim/final transcripts in an AgentSession.

    Args:
        model: ElevenLabs STT model id. One of "scribe_v2_realtime" (default,
            streaming), "scribe_v1", "scribe_v2" (batch only).
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN").
            Converted to ISO 639-1 automatically. When omitted, ElevenLabs
            performs automatic language detection.
        api_key: Optional ElevenLabs API key. If not provided, uses
            settings.ELEVEN_API_KEY.
    """

    # ElevenLabs uses ISO 639-1 base codes ("hi", "ml"), not BCP 47.
    LANGUAGE_FORMAT = "iso6391"

    def __init__(
        self,
        model: str,
        language_code: str,  # BCP 47 format, will be converted
        api_key: Optional[str] = None,
    ) -> None:
        if not model:
            raise ValueError("ElevenLabs STT requires 'model' parameter")

        if not language_code:
            raise ValueError("ElevenLabs STT requires 'language_code' parameter")

        self._model = model

        # Convert language code to ElevenLabs' required ISO 639-1 format
        self._language_code = self.convert_language_code(language_code)

        # Use provided API key or fall back to settings
        self._api_key = api_key or settings.ELEVEN_API_KEY

        if not self._api_key:
            raise ValueError(
                "ElevenLabs STT requires 'api_key' parameter or "
                "ELEVEN_API_KEY in settings"
            )

        if self._model != DEFAULT_ELEVENLABS_STT_MODEL:
            logger.warning(
                "ElevenLabs STT model '%s' does not support streaming; live "
                "agent turns require '%s'. Interim/final transcripts may not "
                "be emitted.",
                self._model,
                DEFAULT_ELEVENLABS_STT_MODEL,
            )

        logger.debug(
            f"Creating ElevenLabs STT with model: {self._model}, language: "
            f"{self._language_code} (from {language_code})"
        )

        # Note: the LiveKit ElevenLabs plugin uses 'model_id' and
        # 'language_code' parameters (not 'model'/'language').
        stt_kwargs: Dict[str, Any] = {
            "model_id": self._model,
            "language_code": self._language_code,
            "api_key": self._api_key,
        }
        if self._model == DEFAULT_ELEVENLABS_STT_MODEL:
            stt_kwargs["server_vad"] = {
                "vad_silence_threshold_secs": COMMIT_SILENCE_S,
                "min_silence_duration_ms": int(COMMIT_SILENCE_S * 1000),
            }
        self._stt_instance = elevenlabs.STT(**stt_kwargs)

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "ElevenLabsSTTClient":
        """
        Create ElevenLabs STT client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "scribe_v2_realtime"}
                Supports both nested (from "config" key) and flat structure
                for backward compatibility. Model is optional and defaults to
                "scribe_v2_realtime".
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            ElevenLabsSTTClient instance
        """
        # Support both nested config structure and flat structure
        # (backward compatibility)
        if "config" in config and isinstance(config["config"], dict):
            config_dict = config["config"]
        else:
            config_dict = config

        model = config_dict.get("model") or DEFAULT_ELEVENLABS_STT_MODEL

        return cls(
            model=model,
            language_code=language_code,
            api_key=settings.ELEVEN_API_KEY,
        )

    @property
    def stt_instance(self) -> elevenlabs.STT:
        """
        Get the underlying ElevenLabs STT instance.

        Returns:
            ElevenLabs STT instance
        """
        return self._stt_instance
