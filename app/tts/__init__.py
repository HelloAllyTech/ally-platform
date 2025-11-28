"""TTS provider abstractions."""
from app.tts.tts import (
    get_tts_for_scenario,
    get_default_tts_config,
    Gender,
)

__all__ = [
    "get_tts_for_scenario",
    "get_default_tts_config",
    "Gender",
]

