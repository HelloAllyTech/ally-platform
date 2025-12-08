"""TTS provider abstractions."""
from app.tts.base import BaseTTSClient
from app.tts.factory import (
    create_tts_client,
    get_default_tts_config,
    Gender,
)
from app.tts.deepgram import DeepgramTTSClient
from app.tts.elevenlabs import ElevenLabsTTSClient
from app.tts.sarvam import SarvamTTSClient
from app.tts.google import GoogleTTSClient
from app.tts.hume import HumeTTSClient

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

