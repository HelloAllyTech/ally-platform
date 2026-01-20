"""
Speech prosody module for generating and applying dynamic prosody parameters.

This module provides orchestration logic for speech prosody generation,
separate from TTS provider-specific implementations.
"""

# Re-export utilities for backward compatibility (if needed)
from app.speech_prosody import utils
from app.speech_prosody.service import SpeechProsodyService

__all__ = ["SpeechProsodyService", "utils"]
