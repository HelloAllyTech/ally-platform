"""TTS provider abstractions."""

from app.core.config import settings
from app.tts.base import BaseTTSClient
from app.tts.factory import Gender, create_tts_client, get_default_tts_config

__all__ = [
    "BaseTTSClient",
    "create_tts_client",
    "get_default_tts_config",
    "Gender",
]

# Concrete provider classes are only re-exported here when lazy imports are
# disabled (see settings.LAZY_PROVIDER_IMPORTS_ENABLED / app/tts/factory.py) —
# otherwise this package's import alone would eagerly load every provider SDK.
# Import straight from the provider submodule (e.g. app.tts.deepgram) instead.
if not settings.LAZY_PROVIDER_IMPORTS_ENABLED:
    from app.tts.deepgram import DeepgramTTSClient
    from app.tts.elevenlabs import ElevenLabsTTSClient
    from app.tts.google import GoogleTTSClient
    from app.tts.hume import HumeTTSClient
    from app.tts.sarvam import SarvamTTSClient

    __all__ += [
        "DeepgramTTSClient",
        "ElevenLabsTTSClient",
        "SarvamTTSClient",
        "GoogleTTSClient",
        "HumeTTSClient",
    ]
