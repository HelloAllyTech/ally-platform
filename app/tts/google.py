"""Google Cloud TTS provider implementation."""

from typing import Any, Dict, Literal, Optional

from livekit.plugins import google

from app.core.config import settings
from app.core.logger import get_logger
from app.tts.base import BaseTTSClient

logger = get_logger(__name__)

# Type aliases for Google TTS parameters
Gender = Literal["male", "female", "neutral"]


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

    # No TEXT_ENHANCEMENT_METADATA: Google TTS with streaming (default) does not
    # support SSML. Tags would be spoken aloud. Prosody is applied via
    # update_options() (speaking_rate) and PARAMETER_METADATA only.

    def __init__(
        self,
        language_code: str,
        gender: Optional[Gender] = None,
        voice_name: Optional[str] = None,
        voice_cloning_key: Optional[str] = None,
        credentials_info: Optional[dict] = None,
        credentials_file: Optional[str] = None,
    ):
        if not language_code:
            raise ValueError("Google TTS requires 'language_code'")

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
                "voice_cloning_key": "..."}
            language_code: BCP 47 language code (e.g., "en-US", "hi-IN")

        Returns:
            GoogleTTSClient instance
        """
        return cls(
            language_code=language_code,
            gender=config.get("gender"),  # Optional
            voice_name=config.get("voice_name"),  # Optional
            voice_cloning_key=config.get("voice_cloning_key"),  # Optional
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
            if self._credentials_info:
                tts_kwargs["credentials_info"] = self._credentials_info
            if self._credentials_file:
                tts_kwargs["credentials_file"] = self._credentials_file

            self._tts_instance = google.TTS(**tts_kwargs)
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
                        f"via update_options(). Use SSML prosody tags in text "
                        f"input instead. See TEXT_ENHANCEMENT_METADATA for details."
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

    async def generate_preview(
        self,
        text: str = "Hello, this is a preview of how I sound.",
    ) -> bytes:
        """
        Generate a preview audio for the given text using Google Cloud TTS SDK.

        Uses the same voice configuration that will be used for LiveKit streaming,
        ensuring the preview sounds identical to production.

        Args:
            text: The text to generate a preview for

        Returns:
            Preview audio as MP3 bytes (browser-compatible)
        """
        from google.cloud import texttospeech

        logger.info(
            f"[Google TTS] Generating preview with language='{self._language_code}', "
            f"voice_name='{self._voice_name}', gender='{self._gender}'"
        )

        try:
            # Create client with credentials if provided
            if self._credentials_file:
                client = texttospeech.TextToSpeechClient.from_service_account_file(
                    self._credentials_file
                )
            elif self._credentials_info:
                client = texttospeech.TextToSpeechClient.from_service_account_info(
                    self._credentials_info
                )
            else:
                # Use Application Default Credentials (ADC)
                client = texttospeech.TextToSpeechClient()

            # Build synthesis input
            synthesis_input = texttospeech.SynthesisInput(text=text)

            # Map gender string to enum
            gender_map = {
                "male": texttospeech.SsmlVoiceGender.MALE,
                "female": texttospeech.SsmlVoiceGender.FEMALE,
                "neutral": texttospeech.SsmlVoiceGender.NEUTRAL,
            }
            ssml_gender = gender_map.get(
                self._gender, texttospeech.SsmlVoiceGender.NEUTRAL
            )

            # Build voice selection params
            if self._voice_name:
                voice_params = texttospeech.VoiceSelectionParams(
                    language_code=self._language_code,
                    name=self._voice_name,
                    ssml_gender=ssml_gender,
                )
            else:
                voice_params = texttospeech.VoiceSelectionParams(
                    language_code=self._language_code,
                    ssml_gender=ssml_gender,
                )

            # Request MP3 output for browser compatibility
            audio_config = texttospeech.AudioConfig(
                audio_encoding=texttospeech.AudioEncoding.MP3,
                sample_rate_hertz=24000,
            )

            # Perform text-to-speech request
            response = client.synthesize_speech(
                input=synthesis_input,
                voice=voice_params,
                audio_config=audio_config,
            )

            mp3_bytes = response.audio_content

            if not mp3_bytes:
                raise ValueError("Google TTS returned empty audio")

            logger.info(f"[Google TTS] Preview generated: {len(mp3_bytes)} MP3 bytes")

            return mp3_bytes

        except Exception as e:
            logger.exception(f"[Google TTS] Preview generation error: {e}")
            raise
