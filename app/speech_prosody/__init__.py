"""
Speech prosody module for generating and applying dynamic prosody parameters.

This module provides orchestration logic for speech prosody generation,
separate from TTS provider-specific implementations.

DEPRECATED (no longer wired into the pipeline). The per-turn prosody pass, the
session-start baseline voice tuning, and the termination-message enhancement
have all been disconnected from the graph and worker. ElevenLabs v3
expressiveness is now produced INLINE by ``generate_response`` (see
``system/audio_tag_guidance``), which made this second-LLM-call rewrite
redundant and slow. The module is retained on disk for a later hard removal;
do not re-wire it without revisiting that latency decision.
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
