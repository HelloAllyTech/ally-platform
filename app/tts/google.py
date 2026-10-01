"""Google Cloud TTS provider implementation."""

from typing import Any, Dict, Literal, Optional

from google.cloud import texttospeech
from livekit.plugins import google

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)

# Type aliases for Google TTS parameters
Gender = Literal["male", "female", "neutral"]

# Cloud TTS model id used by livekit.plugins.google.TTS for Chirp 3 HD / cloning.
_GOOGLE_TTS_CHIRP3_MODEL_NAME = "chirp_3"


class GoogleTTSClient(BaseTTSClient):
    """
    Google Cloud TTS client implementation.

    Based on LiveKit Google TTS plugin:
    https://docs.livekit.io/agents/models/tts/plugins/google/

    Note: There is a known issue in older versions of livekit-plugins-google
    that can cause "RuntimeError: aclose(): asynchronous generator is already
    running" errors. This is handled by LiveKit's error logging and doesn't
    crash the application. Updating to the latest version (>=1.3.6) may
    resolve this issue.

    Args:
        language_code: BCP 47 language code (e.g., "en-US", "hi-IN").
            Defaults to "en-US" if not provided.
        gender: Voice gender - "male", "female", or "neutral" (default: "neutral")
        voice_name: Optional specific voice name (e.g.,
            "en-US-Standard-H", "en-US-Neural2-A")
            See: https://docs.cloud.google.com/text-to-speech/docs/
            list-voices-and-types
        voice_cloning_key: Optional voice cloning key for custom voices (Chirp 3)
        model_name: Optional Cloud TTS model for the LiveKit plugin (e.g.
            ``chirp_3``, ``gemini-2.5-flash-tts``). If omitted, matches
            ``livekit.plugins.google.TTS``: ``chirp_3`` for Chirp/cloned voices,
            otherwise the plugin infers Gemini vs other defaults from ``voice_name``.
        credentials_info: Optional dict of Google Cloud credentials
        credentials_file: Optional path to credentials JSON file
    """

    # Define parameter metadata as class constant
    # Parameter names must match Google TTS API option names
    PARAMETER_METADATA = {
        "speaking_rate": {
            "type": "float",
            "range": [0.25, 2.0],
            "default": 1.0,
            "description": (
                "Speech rate multiplier. 1.0 is normal speed, >1.0 is faster, "
                "<1.0 is slower. Range: 0.25 to 2.0."
            ),
        },
        "pitch": {
            "type": "float",
            "range": [-20.0, 20.0],
            "default": 0.0,
            "description": (
                "Pitch shift in semitones. Positive values = higher pitch "
                "(stress/anxiety). Negative values = lower pitch "
                "(sadness/relaxation). 0.0 = no change. Range: -20.0 to +20.0."
            ),
        },
        "volume_gain_db": {
            "type": "float",
            "range": [-96.0, 16.0],
            "default": 0.0,
            "description": (
                "Volume gain in decibels. Positive values = louder (excitement). "
                "Negative values = quieter (shame/withdrawal). 0.0 = no change. "
                "Range: -96.0 to +16.0 dB (recommended: ≤ +10 dB)."
            ),
        },
    }

    # Google TTS with streaming (default) does not support SSML / inline tags —
    # they would be spoken aloud — so it inherits supports_text_enhancement() ->
    # False from BaseTTSClient. Voice parameters are applied via update_options()
    # (speaking_rate) and PARAMETER_METADATA only.

    @staticmethod
    def _resolve_plugin_model_name(
        explicit_model_name: Optional[str],
        voice_name: Optional[str],
        voice_cloning_key: Optional[str],
    ) -> Optional[str]:
        """
        Resolve ``model_name`` for ``livekit.plugins.google.TTS``.

        Mirrors the plugin's own defaults (see LiveKit ``google/tts.py``):
        explicit ``model_name`` wins; else ``chirp_3`` when using a Chirp voice
        id or voice cloning; else ``None`` so we omit the kwarg and the plugin
        picks ``gemini-2.5-flash-tts`` for Standard/Neural/gemini-style paths.
        """
        if isinstance(explicit_model_name, str) and explicit_model_name.strip():
            return explicit_model_name.strip()
        if voice_cloning_key:
            return _GOOGLE_TTS_CHIRP3_MODEL_NAME
        if isinstance(voice_name, str) and "chirp" in voice_name.lower():
            return _GOOGLE_TTS_CHIRP3_MODEL_NAME
        return None

    def __init__(
        self,
        language_code: str,
        gender: Optional[Gender] = None,
        voice_name: Optional[str] = None,
        voice_cloning_key: Optional[str] = None,
        model_name: Optional[str] = None,
        credentials_info: Optional[dict] = None,
        credentials_file: Optional[str] = None,
    ):
        super().__init__()
        if not language_code:
            raise ValueError("Google TTS requires 'language_code'")

        self._model_name = self._resolve_plugin_model_name(
            model_name, voice_name, voice_cloning_key
        )

        # Validate configuration
        if not self.validate_voice(
            language_code=language_code, gender=gender, voice_name=voice_name
        ):
            raise ValueError(
                f"Invalid Google TTS configuration: "
                f"language_code={language_code}, voice_name={voice_name}"
            )

        self._language_code = language_code
        self._gender = gender or "neutral"
        self._voice_name = voice_name
        self._voice_cloning_key = voice_cloning_key
        self._credentials_info = credentials_info
        # Handle credentials_file - prioritize passed parameter, then settings
        # If no credentials_file is provided, Google TTS will use Application
        # Default Credentials (ADC)
        # In Docker, ADC credentials are mounted at
        # /root/.config/gcloud/application_default_credentials.json
        if credentials_file:
            self._credentials_file = credentials_file
        elif (
            hasattr(settings, "GOOGLE_APPLICATION_CREDENTIALS")
            and settings.GOOGLE_APPLICATION_CREDENTIALS
        ):
            creds_path = settings.GOOGLE_APPLICATION_CREDENTIALS
            # If it's a file path (starts with / or ends with .json), use it
            # Convert host paths to container paths if needed
            if isinstance(creds_path, str):
                # If it's a host path, try to map it to container path
                if creds_path.startswith("/Users/") or creds_path.startswith("/home/"):
                    # Host path - try to find it in mounted volume
                    # For Docker, we expect it to be at /app/google-credentials.json
                    if "/google-credentials.json" in creds_path:
                        self._credentials_file = "/app/google-credentials.json"
                    else:
                        # Try to extract filename and use /app/ prefix
                        import os

                        filename = os.path.basename(creds_path)
                        self._credentials_file = f"/app/{filename}"
                elif creds_path.startswith("/") or creds_path.endswith(".json"):
                    # Already a container path
                    self._credentials_file = creds_path
                else:
                    # Not a file path, might be ADC indicator - don't set
                    # credentials_file
                    self._credentials_file = None
            else:
                self._credentials_file = None
        else:
            # No credentials_file specified - will use Application Default
            # Credentials (ADC)
            self._credentials_file = None
        self._tts_instance = None

    def allows_clip_synthesis(self) -> bool:
        """Clips only for Chirp 3 HD voices (``xx-XX-Chirp3-HD-<Name>``), which
        are fixed speakers. Gemini-TTS is generative: a bare speaker name
        (Kore, Charon), no voice name at all (the plugin then picks Gemini), or
        a ``gemini-*`` model all mean a fresh draw per request. Standard,
        Neural2, WaveNet and cloned voices are unclassified and fail closed
        (see BaseTTSClient.allows_clip_synthesis)."""
        voice = (self._voice_name or "").lower()
        model = (self._model_name or "").lower()
        if not voice or model.startswith("gemini") or self._voice_cloning_key:
            return False
        return "chirp3-hd" in voice

    @staticmethod
    def validate_voice(
        language_code: str,
        gender: Optional[Gender] = None,
        voice_name: Optional[str] = None,
    ) -> bool:
        """
        Validate Google TTS configuration.

        Validates that the language_code and voice_name combination is valid.
        See: https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types

        Args:
            language_code: BCP 47 language code (e.g., "en-US", "hi-IN")
            gender: Voice gender - "male", "female", or "neutral"
            voice_name: Optional specific voice name

        Returns:
            True if validation succeeds, False otherwise
        """
        if not language_code:
            logger.error("Google validation requires 'language_code' parameter")
            return False

        logger.info(
            f"Validating Google TTS language_code='{language_code}', "
            f"voice_name='{voice_name}', gender='{gender}'"
        )

        try:
            # Basic validation - check language code format (BCP 47)
            # Format: language-REGION (e.g., "en-US", "hi-IN")
            parts = language_code.split("-")
            if len(parts) < 2:
                logger.warning(
                    f"Google TTS language_code should be in BCP 47 format "
                    f"(e.g., 'en-US'), got '{language_code}'"
                )

            # If voice_name is provided, validate format
            # Google voice names follow pattern:
            # {language}-{region}-{type}-{variant}
            # Examples: "en-US-Standard-H", "en-US-Neural2-A",
            # "hi-IN-Neural2-A"
            if voice_name:
                voice_parts = voice_name.split("-")
                if len(voice_parts) < 4:
                    logger.warning(
                        f"Google voice_name should follow pattern "
                        f"'{{lang}}-{{region}}-{{type}}-{{variant}}', "
                        f"got '{voice_name}'"
                    )
                # Check if voice_name starts with language_code
                if not voice_name.startswith(language_code.replace("-", "-")):
                    logger.warning(
                        f"voice_name '{voice_name}' should start with "
                        f"language_code '{language_code}'"
                    )

            # Validate gender
            if gender and gender not in ["male", "female", "neutral"]:
                logger.error(
                    f"Invalid gender '{gender}'. Must be 'male', 'female', or 'neutral'"
                )
                return False

            # Note: Full validation would require calling Google Cloud API
            # to list voices
            # For now, we do basic format validation
            return True

        except Exception as e:
            logger.error(f"Google TTS validation failed: {e}")
            return False

    @classmethod
    def from_config(
        cls,
        config: Dict[str, Any],
        language_code: str,
    ) -> "GoogleTTSClient":
        """
        Create Google TTS client from config dictionary.

        Args:
            config: Config dict from metadata. Expected structure:
                {"voice_name": "en-US-Chirp3-HD-Aoede", "gender": "female",
                "model_name": "chirp_3", "voice_cloning_key": "..."}
                If ``model_name`` is missing, Chirp voices still get ``chirp_3``;
                other voice ids omit ``model_name`` and follow the plugin default
                (typically Gemini for non-Chirp names).
            language_code: BCP 47 language code (e.g., "en-US", "hi-IN")

        Returns:
            GoogleTTSClient instance
        """
        raw_model = config.get("model_name")
        model_arg = (
            raw_model.strip()
            if isinstance(raw_model, str) and raw_model.strip()
            else None
        )

        return cls(
            language_code=language_code,
            gender=config.get("gender"),  # Optional
            voice_name=config.get("voice_name"),  # Optional
            voice_cloning_key=config.get("voice_cloning_key"),  # Optional
            model_name=model_arg,
            credentials_file=getattr(
                settings, "GOOGLE_APPLICATION_CREDENTIALS", None
            ),  # Optional
        )

    @property
    def tts_instance(self) -> google.TTS:
        """Get the underlying Google Cloud TTS instance."""
        if self._tts_instance is None:
            # Build kwargs for Google TTS initialization
            tts_kwargs = {
                "language": self._language_code,
                "gender": self._gender,
            }

            # Add optional parameters
            if self._voice_name:
                tts_kwargs["voice_name"] = self._voice_name
            if self._voice_cloning_key:
                tts_kwargs["voice_cloning_key"] = self._voice_cloning_key
            if self._model_name is not None:
                tts_kwargs["model_name"] = self._model_name
            # Chirp 3 HD voices REJECT the plugin's default PCM encoding: Google
            # returns 400 "This voice currently only supports the following audio
            # encodings: LINEAR16, MP3, OGG_OPUS, MULAW, ALAW" (retryable=False),
            # so every synthesis fails and the agent joins but can never speak —
            # the session just appears "stuck". OGG_OPUS is the one encoding Chirp
            # 3 HD supports that the plugin's streaming path also allows, so force
            # it for Chirp voices. Non-Chirp voices keep the plugin default (PCM),
            # unchanged.
            if self._model_name == _GOOGLE_TTS_CHIRP3_MODEL_NAME:
                tts_kwargs["audio_encoding"] = texttospeech.AudioEncoding.OGG_OPUS
            if self._credentials_info:
                tts_kwargs["credentials_info"] = self._credentials_info
            if self._credentials_file:
                tts_kwargs["credentials_file"] = self._credentials_file

            self._tts_instance = google.TTS(**tts_kwargs)
            self._wrap_stream_with_timeout(self._tts_instance)
        return self._tts_instance

    def _apply_parameters_dict(self, params_dict: Dict[str, Any]) -> None:
        """
        Apply validated parameters dict to Google TTS instance.

        Google TTS update_options() only supports 'speaking_rate' parameter.
        Other parameters like 'pitch' and 'volume_gain_db' are not supported
        via update_options() and should be handled via SSML in the text input.

        Args:
            params_dict: Validated dict with parameter names as keys
        """
        try:
            if self.tts_instance is None:
                logger.warning(
                    "[Google TTS] Cannot apply parameters: TTS instance is None"
                )
                return

            if not params_dict:
                logger.debug("[Google TTS] No parameters to apply (empty dict)")
                return

            # Google TTS update_options() only supports 'speaking_rate'
            # Filter out unsupported parameters
            supported_params = {}
            unsupported_params = []

            if "speaking_rate" in params_dict:
                supported_params["speaking_rate"] = params_dict["speaking_rate"]

            # Log warnings for unsupported parameters
            for param_name in ["pitch", "volume_gain_db"]:
                if param_name in params_dict:
                    unsupported_params.append(param_name)
                    logger.warning(
                        f"[Google TTS] Parameter '{param_name}' is not supported "
                        f"via update_options(); it would require SSML prosody tags "
                        f"in the text input, which Google streaming does not support."
                    )

            # Apply only supported parameters
            if supported_params:
                if hasattr(self.tts_instance, "update_options"):
                    self.tts_instance.update_options(**supported_params)
                    logger.debug(
                        f"[Google TTS] Successfully updated options: "
                        f"{supported_params}"
                    )
                else:
                    logger.warning(
                        "[Google TTS] TTS instance does not have "
                        "update_options() method"
                    )
            elif unsupported_params:
                logger.info(
                    f"[Google TTS] No supported parameters to apply. "
                    f"Unsupported parameters: {unsupported_params}. "
                    f"Use SSML prosody tags in text input instead."
                )

        except Exception as e:
            logger.error(
                f"[Google TTS] Failed to update TTS options: {e}", exc_info=True
            )
