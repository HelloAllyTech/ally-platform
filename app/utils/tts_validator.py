import requests
import logging
import base64
from app.core.constants import TTSProvider
from app.core.config import settings
from sarvamai import SarvamAI

# Configure logger
logger = logging.getLogger(__name__)
logger.setLevel(logging.INFO)

if not logger.hasHandlers():
    handler = logging.StreamHandler()
    formatter = logging.Formatter(
        "%(asctime)s [%(levelname)s] %(name)s - %(message)s"
    )
    handler.setFormatter(formatter)
    logger.addHandler(handler)


def validate_deepgram_voice(model: str, api_key: str) -> bool:
    """Validate Deepgram TTS by generating a short audio sample."""
    url = "https://api.deepgram.com/v1/speak"
    params = {"model": model}
    headers = {
        "Authorization": f"Token {api_key}",
        "Content-Type": "application/json",
    }
    payload = {"text": "Hello from Deepgram!"}

    logger.info(f"Validating Deepgram voice model='{model}'")

    try:
        response = requests.post(url, json=payload, headers=headers, params=params, timeout=10)
        logger.info(f"Deepgram response status: {response.status_code}")

        if response.status_code == 200:
            return True
        else:
            logger.warning(f"Deepgram validation failed | Status: {response.status_code} | Response: {response.text}")
            return False

    except Exception as e:
        logger.exception(f"Deepgram validation error: {e}")
        return False


def validate_sarvam_voice(speaker: str, api_key: str) -> bool:
    """Validate a Sarvam TTS voice using the official SDK."""
    try:
        client = SarvamAI(api_subscription_key=api_key)
        response = client.text_to_speech.convert(
            target_language_code="en-IN",
            text="Hello from Sarvam AI!",
            model="bulbul:v2",
            speaker=speaker,
        )

        if hasattr(response, "audios") and response.audios:
            audio_b64 = response.audios[0]
            try:
                base64.b64decode(audio_b64)
                logger.info("Sarvam TTS validation passed")
                return True
            except Exception:
                logger.warning("Invalid audio data in Sarvam response")
                return False

        logger.warning("Sarvam validation failed | No audio found in response")
        return False

    except Exception as e:
        logger.warning(f"Sarvam TTS check failed: {e}")
        return False


def validate_elevenlabs_voice(voice_id: str, api_key: str, model: str) -> bool:
    """Validate ElevenLabs voice by checking voice existence."""
    url = f"https://api.elevenlabs.io/v1/voices/{voice_id}"
    headers = {"xi-api-key": api_key}
    logger.info(f"Validating ElevenLabs voice voice_id='{voice_id}'")

    try:
        response = requests.get(url, headers=headers, timeout=10)
        logger.info(f"ElevenLabs response status: {response.status_code}")

        if response.status_code == 200:
            logger.info("ElevenLabs voice validation successful")
            return True
        else:
            logger.warning(f"ElevenLabs validation failed | Status: {response.status_code} | Response: {response.text}")
            return False

    except Exception as e:
        logger.exception(f"ElevenLabs validation error: {e}")
        return False


def validate_current_voice() -> bool:
    """Main entry to validate the active TTS provider voice."""
    provider = settings.TTS_PROVIDER
    logger.info(f"Starting voice validation for provider='{provider}'")

    try:
        if provider == TTSProvider.DEEPGRAM:
            result = validate_deepgram_voice(settings.VOICE_ID, settings.DEEPGRAM_API_KEY)
        elif provider == TTSProvider.SARVAM:
            result = validate_sarvam_voice(settings.VOICE_ID, settings.SARVAM_API_KEY)
        elif provider == TTSProvider.ELEVENLABS:
            result = validate_elevenlabs_voice(settings.VOICE_ID, settings.ELEVEN_API_KEY)
        else:
            logger.error(f"Unsupported TTS provider: {provider}")
            return False

        logger.info(f"Validation result for {provider}: {result}")
        return result

    except Exception as e:
        logger.exception(f"Unexpected error during voice validation: {e}")
        return False


if __name__ == "__main__":
    result = validate_current_voice()
    logger.info(f"Final voice validation result: {result}")
