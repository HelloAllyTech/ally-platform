"""Utterance length-based event detection."""

from app.core.events.event_types.utterance_length.constants import UtteranceLengthData
from app.core.events.event_types.utterance_length.utterance_length_event import (
    UtteranceLengthEvent,
)

__all__ = ["UtteranceLengthEvent", "UtteranceLengthData"]
