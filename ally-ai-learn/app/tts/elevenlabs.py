"""ElevenLabs TTS provider implementation."""

from typing import Any, Dict, Optional

from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError as ElevenLabsApiError
from livekit.agents import tts as agents_tts
from livekit.plugins import elevenlabs
from livekit.plugins.elevenlabs import VoiceSettings

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient
from app.tts.gain import GainTTS

logger = get_logger(__name__)


class ElevenLabsTTSClient(BaseTTSClient):
    """
    ElevenLabs TTS client implementation.

    Args:
        model: ElevenLabs model name
        voice_id: ElevenLabs voice ID
        language_code: BCP 47 language code (not used by ElevenLabs,
            but kept for consistency)
        api_key: Optional API key (defaults to settings.ELEVEN_API_KEY)
    """

    # Define parameter metadata as class constant
    # Parameter names must match ElevenLabs TTS API option names
    PARAMETER_METADATA = {
        "speed": {
            "type": "float",
            "range": [0.85, 1.15],
            "default": 1.0,
            "description": (
                "Speech speed multiplier. 1.0 is normal speed, >1.0 is faster, "
                "<1.0 is slower. Range: 0.85 to 1.15."
            ),
        },
        "stability": {
            "type": "float",
            "range": [0.5, 1.0],
            "default": 0.71,
            "description": (
                "Voice stability/consistency. Lower values (0.0-0.5) = more "
                "expressive/emotional variation. Higher values (0.7-1.0) = more "
                "stable/controlled voice. Range: 0.5 to 1.0."
            ),
        },
        "similarity_boost": {
            "type": "float",
            "range": [0.0, 1.0],
            "default": 0.5,
            "description": (
                "Similarity to original voice. Higher values (0.7-1.0) = closer "
                "match to original voice character. Lower values (0.0-0.5) = more "
                "deviation in style/timbre. Range: 0.0 to 1.0."
            ),
        },
    }

    # Inline audio tags (v3/v4 models only). The instruction TEXT lives in prompt
    # management — prompt code `ally_ai_learn_system_audio_tag_guidance`, local
    # fallback `app/prompts/system/audio_tag_guidance.txt` — so superadmins can
    # edit it. This client only advertises the capability via
    # supports_text_enhancement(); callers resolve the text from prompt management.

    # Model-id markers for ElevenLabs' generative (v3/v4) families.
    GENERATIVE_MODEL_MARKERS = ("v3", "v4")
    # The v4 family renders 7-10 dB quieter than v3 for the same voice and
    # ElevenLabs exposes no loudness control, so v4 output gets a fixed boost
    # (settings.ELEVENLABS_V4_GAIN_DB) through a peak-limited GainTTS.
    GAIN_MODEL_MARKERS = ("v4",)

    @property
    def _is_v3_model(self) -> bool:
        """Back-compat alias: True for every generative (v3 or v4) model."""
        return self._is_generative_model

    def __init__(
        self,
        model: str,
        voice_id: str,
        language_code: str,
        api_key: Optional[str] = None,
    ):
        super().__init__()
        logger.debug(
            f"[ElevenLabs] __init__ called with model={model}, "
            f"voice_id={voice_id}, language_code={language_code}"
        )

        if not voice_id:
            logger.error("[ElevenLabs] __init__: voice_id is required")
            raise ValueError("ElevenLabs TTS requires 'voice_id'")
        if not model:
            logger.error("[ElevenLabs] __init__: model is required")
            raise ValueError("ElevenLabs TTS requires 'model'")

        self._model = model
        self._voice_id = voice_id
        self._language_code = language_code
        self._api_key = api_key or settings.ELEVEN_API_KEY
        self._tts_instance: Optional[agents_tts.TTS] = None
        self._base_tts: Optional[elevenlabs.TTS] = None

        # v3 and v4 families (eleven_v3, eleven_v3_conversational, eleven_v4,
        # eleven_v4_turbo) are generative "dialogue" models: ElevenLabs serves
        # them only over HTTP /stream and the text-to-dialogue socket, never the
        # text-to-speech multi-stream-input socket the plugin uses. Verified
        # live 2026-10-14: v4 and v4_turbo fail the WS connect and succeed on
        # the HTTP StreamAdapter path. Both families take inline audio tags.
        self._is_generative_model = any(
            marker in model.lower() for marker in self.GENERATIVE_MODEL_MARKERS
        )
        self._supports_audio_tags = self._is_generative_model
        self._needs_gain = any(
            marker in model.lower() for marker in self.GAIN_MODEL_MARKERS
        )

    @staticmethod
    def validate_voice(voice_id: str, api_key: Optional[str] = None) -> bool:
        """
        Validate an ElevenLabs voice by fetching metadata using the SDK.

        Args:
            voice_id: ElevenLabs voice ID
            api_key: Optional API key (defaults to settings.ELEVEN_API_KEY)

        Returns:
            True if validation succeeds, False otherwise
        """
        logger.debug(f"[ElevenLabs] validate_voice called with voice_id: {voice_id}")

        if not voice_id:
            logger.error("[ElevenLabs] Validation requires 'voice_id' parameter")
            return False

        try:
            key = api_key or settings.ELEVEN_API_KEY
            logger.debug(
                f"[ElevenLabs] Creating ElevenLabs client with API key "
                f"(present: {bool(key)})"
            )
            client = ElevenLabs(api_key=key)
            logger.debug(
                f"[ElevenLabs] Fetching voice metadata for voice_id: {voice_id}"
            )
            voice = client.voices.get(voice_id=voice_id)
            logger.debug(f"[ElevenLabs] Voice API response: {voice}")

            if voice and getattr(voice, "voice_id", None) == voice_id:
                logger.info(
                    f"[ElevenLabs] Voice validation successful for voice_id: {voice_id}"
                )
                return True

            logger.warning(
                f"[ElevenLabs] Validation failed | Unexpected response: {voice!r}"
            )
            return False

        except ElevenLabsApiError as api_err:
            logger.warning(f"[ElevenLabs] Validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"[ElevenLabs] Validation error: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "ElevenLabsTTSClient":
        """
        Create ElevenLabs TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "eleven_turbo_v2_5", "voice_id": "..."}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            ElevenLabsTTSClient instance
        """
        logger.debug(
            f"[ElevenLabs] from_config called with config: {config}, "
            f"language_code: {language_code}"
        )
        model = config.get("model")
        voice_id = config.get("voice_id") or config.get("voiceId")

        logger.debug(f"[ElevenLabs] Extracted model: {model}, voice_id: {voice_id}")

        if not model:
            logger.error("[ElevenLabs] Missing 'model' in config")
            raise ValueError("ElevenLabs TTS requires 'model' in config")
        if not voice_id:
            logger.error("[ElevenLabs] Missing 'voice_id' or 'voiceId' in config")
            raise ValueError(
                "ElevenLabs TTS requires 'voice_id' or 'voiceId' in config"
            )

        logger.debug(
            f"[ElevenLabs] Creating ElevenLabsTTSClient with model={model}, "
            f"voice_id={voice_id}, language_code={language_code}"
        )
        return cls(
            model=model,
            voice_id=voice_id,
            language_code=language_code,
            api_key=settings.ELEVEN_API_KEY,
        )

    @property
    def tts_instance(self) -> agents_tts.TTS:
        """Get the underlying ElevenLabs TTS instance."""
        if self._tts_instance is None:
            base = elevenlabs.TTS(
                voice_id=self._voice_id,
                model=self._model,
                api_key=self._api_key,
                inactivity_timeout=30.0,
            )
            self._base_tts = base
            self._wrap_stream_with_timeout(base)
            if self._is_generative_model:
                # v3/v4 models are generative and sentence-streamed, so they need
                # higher stability to avoid noticeable voice shifts mid-reply.
                voice_settings = VoiceSettings(stability=0.95, similarity_boost=0.75)
                base.update_options(voice_settings=voice_settings)
                # v3/v4 have no WebSocket multi-stream-input support
                # (livekit/agents#4901). StreamAdapter sentence-streams via
                # the plugin's HTTP /stream chunked path instead.
                instance: agents_tts.TTS = agents_tts.StreamAdapter(tts=base)
            else:
                instance = base
            gain_db = self._configured_gain_db()
            if self._needs_gain and gain_db > 0:
                # v4 is 7-10 dB under v3 for the same voice; lift it so a
                # character sounds the same loudness on either model.
                instance = GainTTS(tts=instance, gain_db=gain_db)
                logger.info(
                    f"[ElevenLabs] gain +{gain_db:g} dB applied for model={self._model}"
                )
            self._tts_instance = instance
        return self._tts_instance

    @staticmethod
    def _configured_gain_db() -> float:
        """ELEVENLABS_V4_GAIN_DB as a float, or 0 when unset or not numeric."""
        value = getattr(settings, "ELEVENLABS_V4_GAIN_DB", 0.0)
        return float(value) if isinstance(value, (int, float)) else 0.0

    def allows_clip_synthesis(self) -> bool:
        """Clips for flash, turbo, multilingual_v2 and the v3/v4 models.

        v3/v4 are generative, but the live reply on v3 is ALREADY one independent
        generation per sentence (StreamAdapter over the HTTP path), held to one
        speaker only by the fixed voice settings in ``tts_instance``. A clip
        built by ``create_clip_tts`` gets the same voice id, model and settings,
        so it is one more such sentence — not a second voice. A clip rendered
        on a DIFFERENT model (multilingual_v2/flash for a v3 voice) would be,
        and is never done. Other models are unclassified and fail closed (see
        BaseTTSClient.allows_clip_synthesis)."""
        if self._is_generative_model:
            return True
        model = self._model.lower()
        return any(family in model for family in ("flash", "turbo", "multilingual_v2"))

    def supports_text_enhancement(self) -> bool:
        """
        Whether inline audio tags are supported (ElevenLabs v3/v4 models only).

        Capability flag only — the tag instruction text lives in prompt
        management (see the class comment above).

        Returns:
            True for v3/v4 models, False for v2/turbo/flash.
        """
        return self._supports_audio_tags

    def _apply_parameters_dict(self, params_dict: Dict[str, Any]) -> None:
        """
        Apply validated parameters dict to ElevenLabs TTS instance.

        ElevenLabs TTS requires parameters to be wrapped in VoiceSettings object.

        Args:
            params_dict: Validated dict with parameter names as keys
        """
        try:
            # Trigger lazy init so self._base_tts is populated.
            _ = self.tts_instance
            target = self._base_tts
            if target is None:
                logger.warning(
                    "[ElevenLabs] Cannot apply parameters: TTS instance is None"
                )
                return

            if not params_dict:
                logger.debug("[ElevenLabs] No parameters to apply (empty dict)")
                return

            # ElevenLabs requires speed to be in VoiceSettings object
            # required arguments. Use values from params_dict if available, otherwise
            # use the existing settings from the TTS instance to avoid incorrectly
            # reverting generative-model defaults.
            current_settings = getattr(
                getattr(target, "options", None), "voice_settings", None
            )

            current_stability = getattr(
                current_settings, "stability", 0.71
            )  # LiveKit default
            current_similarity_boost = getattr(
                current_settings, "similarity_boost", 0.5
            )  # LiveKit default
            current_speed = getattr(current_settings, "speed", 1.0)

            speed_value = params_dict.get("speed", current_speed)
            stability_value = params_dict.get("stability", current_stability)
            similarity_boost_value = params_dict.get(
                "similarity_boost", current_similarity_boost
            )

            voice_settings = VoiceSettings(
                stability=stability_value,
                similarity_boost=similarity_boost_value,
                speed=speed_value,
            )

            logger.debug(
                f"[ElevenLabs] Applying VoiceSettings: speed={speed_value}, "
                f"stability={stability_value}, "
                f"similarity_boost={similarity_boost_value}"
            )

            # Update TTS options with VoiceSettings
            if hasattr(target, "update_options"):
                target.update_options(voice_settings=voice_settings)
                logger.debug(
                    "[ElevenLabs] Successfully updated TTS options with VoiceSettings"
                )
            else:
                logger.warning(
                    "[ElevenLabs] TTS instance does not have update_options() method"
                )

        except Exception as e:
            logger.error(
                f"[ElevenLabs] Failed to update TTS options: {e}", exc_info=True
            )
