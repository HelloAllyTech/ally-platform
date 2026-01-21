"""
Speech prosody module for generating and applying dynamic prosody parameters.

This module provides orchestration logic for speech prosody generation,
separate from TTS provider-specific implementations.
"""

from app.speech_prosody import utils
from app.speech_prosody.service import (
    SpeechProsodyService,
    generate_and_apply_prosody_for_message,
)

__all__ = [
    "SpeechProsodyService",
    "generate_and_apply_prosody_for_message",
    "utils",
]
