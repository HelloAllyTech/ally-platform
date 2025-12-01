import base64
import logging
from typing import Optional

from deepgram import DeepgramClient
from deepgram.core import ApiError as DeepgramApiError
from elevenlabs import ElevenLabs
from elevenlabs.core import ApiError as ElevenLabsApiError
from sarvamai import SarvamAI
from sarvamai.core import ApiError as SarvamaiApiError

from app.core.constants import TTSProvider
from app.core.config import settings

logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

if not logger.hasHandlers():
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s - %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)


def validate_deepgram_voice(**kwargs) -> bool:
    """Validate Deepgram TTS model using SDK by generating a short audio sample."""
    model = kwargs.get('model')
    if not model:
        logger.error("Deepgram validation requires 'model' parameter")
        return False
    
    logger.info(f"Validating Deepgram voice model='{model}'")

    try:
        client = DeepgramClient(api_key=settings.DEEPGRAM_API_KEY)
        test_text = "Test"

        # Deepgram returns a generator yielding audio chunks
        audio_stream = client.speak.v1.audio.generate(
            text=test_text,
            model=model,
            encoding="linear16",
            sample_rate=16000,
        )

        audio_bytes = b"".join(chunk for chunk in audio_stream)

        if audio_bytes:
            logger.info(f"Deepgram voice validation succeeded. Generated {len(audio_bytes)} bytes.")
            return True

        logger.warning("Deepgram voice validation failed: No audio data generated.")
        return False

    except DeepgramApiError as api_err:
        logger.warning(f"Deepgram validation failed | API error: {api_err}")
        return False
    except Exception as e:
        logger.exception(f"Deepgram validation error: {e}")
        return False


def validate_sarvam_voice(**kwargs) -> bool:
    """Validate Sarvam TTS speaker by generating a short audio sample."""
    model = kwargs.get('model')
    speaker = kwargs.get('speaker')
    
    if not model or not speaker:
        logger.error(f"Sarvam validation requires both 'model' and 'speaker' parameters. Got model='{model}', speaker='{speaker}'")
        return False
    
    logger.info(f"Validating Sarvam voice model='{model}', speaker='{speaker}'")

    try:
        client = SarvamAI(api_subscription_key=settings.SARVAM_API_KEY)
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


def validate_elevenlabs_voice(**kwargs) -> bool:
    """
    Validate an ElevenLabs voice by fetching metadata using the SDK.
    """
    voice_id = kwargs.get('voice_id')
    if not voice_id:
        logger.error("ElevenLabs validation requires 'voice_id' parameter")
        return False
    
    logger.info(f"Validating ElevenLabs voice voice_id='{voice_id}'")

    try:
        client = ElevenLabs(api_key=settings.ELEVEN_API_KEY)
        voice = client.voices.get(voice_id=voice_id)

        if voice and getattr(voice, "voice_id", None) == voice_id:
            logger.info("ElevenLabs voice validation successful")
            return True

        logger.warning(f"ElevenLabs validation failed | Unexpected response: {voice!r}")
        return False

    except ElevenLabsApiError as api_err:
        logger.warning(f"ElevenLabs validation failed | API error: {api_err}")
        return False
    except Exception as e:
        logger.exception(f"ElevenLabs validation error: {e}")
        return False


def validate_google_voice(**kwargs) -> bool:
    """
    Validate Google TTS configuration.
    
    Validates that the language_code and voice_name combination is valid.
    See: https://docs.cloud.google.com/text-to-speech/docs/list-voices-and-types
    """
    language_code = kwargs.get('language_code')
    voice_name = kwargs.get('voice_name')
    gender = kwargs.get('gender')
    
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
        parts = language_code.split('-')
        if len(parts) < 2:
            logger.warning(f"Google TTS language_code should be in BCP 47 format (e.g., 'en-US'), got '{language_code}'")
        
        # If voice_name is provided, validate format
        # Google voice names follow pattern: {language}-{region}-{type}-{variant}
        # Examples: "en-US-Standard-H", "en-US-Neural2-A", "hi-IN-Neural2-A"
        if voice_name:
            voice_parts = voice_name.split('-')
            if len(voice_parts) < 4:
                logger.warning(
                    f"Google voice_name should follow pattern '{{lang}}-{{region}}-{{type}}-{{variant}}', "
                    f"got '{voice_name}'"
                )
            # Check if voice_name starts with language_code
            if not voice_name.startswith(language_code.replace('-', '-')):
                logger.warning(
                    f"voice_name '{voice_name}' should start with language_code '{language_code}'"
                )
        
        # Validate gender
        if gender and gender not in ["male", "female", "neutral"]:
            logger.error(f"Invalid gender '{gender}'. Must be 'male', 'female', or 'neutral'")
            return False
        
        # Note: Full validation would require calling Google Cloud API to list voices
        # For now, we do basic format validation
        return True
        
    except Exception as e:
        logger.error(f"Google TTS validation failed: {e}")
        return False


