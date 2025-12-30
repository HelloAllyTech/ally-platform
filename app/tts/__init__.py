"""TTS provider abstractions."""

from app.tts.base import BaseTTSClient
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.factory import Gender, create_tts_client, get_default_tts_config
from app.tts.google import GoogleTTSClient
from app.tts.hume import HumeTTSClient
from app.tts.sarvam import SarvamTTSClient

__all__ = [
    "BaseTTSClient",
    "create_tts_client",
    "get_default_tts_config",
    "Gender",
    "DeepgramTTSClient",
    "ElevenLabsTTSClient",
    "SarvamTTSClient",
    "GoogleTTSClient",
    "HumeTTSClient",
]
