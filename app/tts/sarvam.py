"""Sarvam TTS provider implementation."""

import base64
from typing import Any, Dict, Optional

from livekit.plugins import sarvam
from sarvamai import SarvamAI
from sarvamai.core import ApiError as SarvamaiApiError

from app.core.config import settings
from app.core.constants import convert_language_code_for_sarvam
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)


class SarvamTTSClient(BaseTTSClient):
    """
    Sarvam TTS client implementation.

    Args:
        model: Sarvam model name (e.g., "multilingual-meera")
        speaker: Sarvam speaker name (e.g., "meera", "arjun")
        language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")
        api_key: Optional API key (defaults to settings.SARVAM_API_KEY)
    """

    # Define parameter metadata as class constant
    # Parameter names must match Sarvam TTS API option names
    PARAMETER_METADATA = {
        "pace": {
            "type": "float",
            "range": [0.3, 3.0],
            "default": 1.0,
            "description": (
                "Speech pace (speed) multiplier. 1.0 is normal speed, >1.0 is "
                "faster, <1.0 is slower. Range: 0.3 (slowest) to 3.0 (fastest)."
            ),
        },
        "pitch": {
            "type": "float",
            "range": [-0.75, 0.75],
            "default": 0.0,
            "description": (
                "Pitch shift in semitones. Positive values = higher pitch "
                "(stress/anxiety). Negative values = lower pitch (sadness/relaxation). "
                "0.0 = no change. Range: -0.75 to +0.75."
            ),
        },
        "loudness": {
            "type": "float",
            "range": [0.5, 2.0],
            "default": 1.0,
            "description": (
                "Volume/loudness multiplier. 1.0 = normal volume. Higher values "
                "(1.5-2.0) = louder (excitement). Lower values (0.5-0.7) = quieter "
                "(shame/withdrawal). Range: 0.5 to 2.0."
            ),
        },
    }

    def __init__(
        self,
        model: str,
        speaker: str,
        language_code: str,
        api_key: Optional[str] = None,
        tts_instance: Optional["sarvam.TTS"] = None,
    ):
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker'")
        if not model:
            raise ValueError("Sarvam TTS requires 'model'")

        # Convert language code to Sarvam format (en-GB/en-US -> en-IN, or-IN -> od-IN)
        target_language = convert_language_code_for_sarvam(language_code)

        # Validate configuration
        if not self.validate_voice(model=model, speaker=speaker, api_key=api_key):
            raise ValueError(
                f"Invalid Sarvam configuration: model={model}, speaker={speaker}"
            )

        self._model = model
        self._speaker = speaker
        self._language_code = language_code
        self._target_language = target_language
        self._api_key = api_key or settings.SARVAM_API_KEY
        self._tts_instance = tts_instance

    @staticmethod
    def validate_voice(model: str, speaker: str, api_key: Optional[str] = None) -> bool:
        """
        Validate Sarvam TTS speaker by generating a short audio sample.

        Args:
            model: Sarvam model name
            speaker: Sarvam speaker name
            api_key: Optional API key (defaults to settings.SARVAM_API_KEY)

        Returns:
            True if validation succeeds, False otherwise
        """
        if not model or not speaker:
            logger.error(
                f"Sarvam validation requires both 'model' and 'speaker' "
                f"parameters. Got model='{model}', speaker='{speaker}'"
            )
            return False

        logger.info(f"Validating Sarvam voice model='{model}', speaker='{speaker}'")

        try:
            key = api_key or settings.SARVAM_API_KEY
            client = SarvamAI(api_subscription_key=key)
            response = client.text_to_speech.convert(
                target_language_code="en-IN",
                text="Hello from Sarvam AI!",
                model=model,
                speaker=speaker,
            )

            if not getattr(response, "audios", None):
                logger.warning("Sarvam validation failed | No audio found in response")
                return False

            try:
                base64.b64decode(response.audios[0])
                logger.info("Sarvam TTS validation passed")
                return True
            except Exception:
                logger.warning("Sarvam validation failed | Invalid audio data")
                return False

        except SarvamaiApiError as api_err:
            logger.warning(f"Sarvam validation failed | API error: {api_err}")
            return False
        except Exception as e:
            logger.exception(f"Sarvam TTS validation error: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "SarvamTTSClient":
        """
        Create Sarvam TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"model": "bulbul:v2", "speaker": "anushka"}
            language_code: BCP 47 language code (e.g., "en-IN", "hi-IN")

        Returns:
            SarvamTTSClient instance
        """
        model = config.get("model")
        speaker = config.get("speaker")

        if not model:
            raise ValueError("Sarvam TTS requires 'model' in config")
        if not speaker:
            raise ValueError("Sarvam TTS requires 'speaker' in config")

        return cls(
            model=model,
            speaker=speaker,
            language_code=language_code,
            api_key=settings.SARVAM_API_KEY,
        )

    @property
    def tts_instance(self) -> "sarvam.TTS":
        """Get the underlying Sarvam TTS instance."""
        if self._tts_instance is None:
            # Create TTS instance - parameters will be set via update_options()
            # before synthesis starts
            self._tts_instance = sarvam.TTS(
                target_language_code=self._target_language,
                speaker=self._speaker,
                api_key=self._api_key,
            )

        # Wrap stream method to inject higher timeout
        # Apply this even if instance was provided via __init__
        if not hasattr(self._tts_instance, "_timeout_wrapped"):
            from livekit.agents import APIConnectOptions

            # Use getattr to avoid potential Mock issues
            original_stream = getattr(self._tts_instance, "stream")

            def custom_stream(
                conn_options: Optional[APIConnectOptions] = None,
            ) -> Any:
                if conn_options is None:
                    conn_options = APIConnectOptions(
                        timeout=settings.SARVAM_TTS_TIMEOUT
                    )
                else:
                    from dataclasses import replace

                    conn_options = replace(
                        conn_options, timeout=settings.SARVAM_TTS_TIMEOUT
                    )
                return original_stream(conn_options=conn_options)

            # Explicitly override the method on the instance level
            # This works for both regular objects and Mocks
            object.__setattr__(self._tts_instance, "stream", custom_stream)
            object.__setattr__(self._tts_instance, "_timeout_wrapped", True)

        # Apply current parameters immediately after creation
        # This ensures they're set before WebSocket session starts
        if hasattr(self, "_current_params") and self._current_params:
            valid_params = {
                k: v
                for k, v in self._current_params.items()
                if k in ["pace", "pitch", "loudness"]
            }
            if valid_params:
                try:
                    if hasattr(self._tts_instance, "update_options"):
                        self._tts_instance.update_options(**valid_params)
                except Exception as e:
                    logger.warning(
                        f"[Sarvam] Failed to apply parameters to new instance: " f"{e}"
                    )
        return self._tts_instance

    def _apply_parameters_dict(self, params_dict: Dict[str, Any]) -> None:
        """
        Apply validated parameters dict to Sarvam TTS instance.

        For Sarvam TTS, we need to ensure parameters are set before the WebSocket
        session starts. If the instance already exists, we use update_options().
        If it doesn't exist yet, parameters will be set when it's created.

        Args:
            params_dict: Validated dict with parameter names as keys
        """
        try:
            if not params_dict:
                logger.debug("[Sarvam] No parameters to apply (empty dict)")
                return

            # Update stored parameters first
            if not hasattr(self, "_current_params"):
                self._current_params = {}
            self._current_params.update(params_dict)

            # If TTS instance already exists, update it
            if self._tts_instance is not None:
                if hasattr(self._tts_instance, "update_options"):
                    self._tts_instance.update_options(**params_dict)
                else:
                    logger.warning(
                        "[Sarvam] TTS instance does not have update_options() "
                        "method. Parameters will be applied on next instance "
                        "creation."
                    )
            else:
                # Instance doesn't exist yet - parameters will be set when
                # tts_instance property is accessed
                logger.debug(
                    "[Sarvam] TTS instance not created yet. Parameters "
                    "will be applied when instance is created."
                )

        except Exception as e:
            logger.error(f"[Sarvam] Failed to update TTS options: {e}", exc_info=True)

    async def generate_preview(
        self,
        text: str = "Hello, this is a preview of how I sound.",
    ) -> bytes:
        """
        Generate a preview audio for the given text using native Sarvam SDK.

        Uses the same model and speaker configuration that will be used for
        LiveKit streaming, ensuring the preview sounds identical to production.

        Args:
            text: The text to generate a preview for

        Returns:
            Preview audio as MP3 bytes (browser-compatible)
        """
        import io

        from pydub import AudioSegment

        logger.info(
            f"[Sarvam] Generating preview with model='{self._model}', "
            f"speaker='{self._speaker}', language='{self._target_language}'"
        )

        try:
            # Use native Sarvam SDK (same as validation)
            client = SarvamAI(api_subscription_key=self._api_key)

            response = client.text_to_speech.convert(
                target_language_code=self._target_language,
                text=text,
                model=self._model,
                speaker=self._speaker,
            )

            if not getattr(response, "audios", None):
                raise ValueError("Sarvam returned no audio data")

            # Sarvam returns base64-encoded WAV audio
            wav_bytes = base64.b64decode(response.audios[0])

            if not wav_bytes:
                raise ValueError("Sarvam returned empty audio")

            logger.debug(f"[Sarvam] Generated {len(wav_bytes)} bytes of WAV audio")

            # Convert WAV to MP3 for browser compatibility
            audio = AudioSegment.from_wav(io.BytesIO(wav_bytes))

            mp3_buffer = io.BytesIO()
            audio.export(mp3_buffer, format="mp3", bitrate="128k")
            mp3_bytes = mp3_buffer.getvalue()

            logger.info(
                f"[Sarvam] Preview generated: {len(wav_bytes)} WAV bytes -> "
                f"{len(mp3_bytes)} MP3 bytes"
            )

            return mp3_bytes

        except SarvamaiApiError as api_err:
            logger.error(f"[Sarvam] Preview failed | API error: {api_err}")
            raise
        except Exception as e:
            logger.exception(f"[Sarvam] Preview generation error: {e}")
            raise
