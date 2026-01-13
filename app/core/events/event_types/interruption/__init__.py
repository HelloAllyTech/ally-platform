"""Interruption-based event detection."""

from app.core.events.event_types.interruption.constants import InterruptionData
from app.core.events.event_types.interruption.interruption_event import (
    InterruptionEvent,
)

__all__ = ["InterruptionEvent", "InterruptionData"]
