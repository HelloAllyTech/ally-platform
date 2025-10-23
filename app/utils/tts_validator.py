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


def validate_deepgram_voice(model: str) -> bool:
    """Validate Deepgram TTS model using SDK by generating a short audio sample."""
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


def validate_sarvam_voice(speaker: str) -> bool:
    """Validate Sarvam TTS speaker by generating a short audio sample."""
    logger.info(f"Validating Sarvam voice speaker='{speaker}'")

    try:
        client = SarvamAI(api_subscription_key=settings.SARVAM_API_KEY)
        response = client.text_to_speech.convert(
            target_language_code="en-IN",
            text="Hello from Sarvam AI!",
            model="bulbul:v2",
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


def validate_elevenlabs_voice(voice_id: str) -> bool:
    """
    Validate an ElevenLabs voice by fetching metadata using the SDK.
    model parameter included for interface consistency.
    """
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


def validate_current_voice() -> bool:
    """Validate the currently configured TTS provider and voice."""
    provider = settings.TTS_PROVIDER
    logger.info(f"Starting voice validation for provider='{provider}'")

    try:
        if provider == TTSProvider.DEEPGRAM:
            return validate_deepgram_voice(settings.VOICE_ID)
        elif provider == TTSProvider.SARVAM:
            return validate_sarvam_voice(settings.VOICE_ID)
        elif provider == TTSProvider.ELEVENLABS:
            return validate_elevenlabs_voice(settings.VOICE_ID)
        else:
            logger.error(f"Unsupported TTS provider: {provider}")
            return False

    except Exception as e:
        logger.exception(f"Unexpected error during voice validation: {e}")
        return False


if __name__ == "__main__":
    result = validate_current_voice()
    logger.info(f"Final voice validation result: {result}")
