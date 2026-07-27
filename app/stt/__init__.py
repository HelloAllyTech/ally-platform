"""STT provider abstractions."""

from app.core.config import settings
from app.stt.base import BaseSTTClient
from app.stt.factory import create_stt_client

__all__ = [
    "BaseSTTClient",
    "create_stt_client",
]

# Concrete provider classes are only re-exported here when lazy imports are
# disabled (see settings.LAZY_PROVIDER_IMPORTS_ENABLED / app/stt/factory.py) —
# otherwise this package's import alone would eagerly load every provider SDK.
# Import straight from the provider submodule (e.g. app.stt.deepgram) instead.
if not settings.LAZY_PROVIDER_IMPORTS_ENABLED:
    from app.stt.deepgram import DeepgramSTTClient
    from app.stt.elevenlabs import ElevenLabsSTTClient
    from app.stt.google import GoogleSTTClient
    from app.stt.sarvam import SarvamSTTClient

    __all__ += [
        "DeepgramSTTClient",
        "ElevenLabsSTTClient",
        "GoogleSTTClient",
        "SarvamSTTClient",
    ]
