"""Data models for interruption-based events."""

from pydantic import BaseModel


class InterruptionData(BaseModel):
    """Data structure for HELPER_INTERRUPTED detection type."""

    # No specific data needed for interruption detection
    # The event is detected based on message sequence and timing
    pass
