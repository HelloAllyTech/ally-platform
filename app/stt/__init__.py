"""STT provider abstractions."""
from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.stt.google import GoogleSTTClient
from app.stt.sarvam import SarvamSTTClient
from app.stt.factory import create_stt_client

__all__ = [
    "BaseSTTClient",
    "DeepgramSTTClient",
    "GoogleSTTClient",
    "SarvamSTTClient",
    "create_stt_client",
]

