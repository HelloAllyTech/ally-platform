"""STT provider abstractions."""
from app.stt.base import BaseSTTClient
from app.stt.deepgram import DeepgramSTTClient
from app.stt.factory import create_stt_client

__all__ = [
    "BaseSTTClient",
    "DeepgramSTTClient",
    "create_stt_client",
]

