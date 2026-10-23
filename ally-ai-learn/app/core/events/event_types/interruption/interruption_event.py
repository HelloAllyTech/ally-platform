"""
Interruption-based event detection.
Tracks when the counselor interrupts the agent while the agent is speaking.
"""

from typing import List

from typing_extensions import override

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.interruption.constants import InterruptionData

# Module-level variable to store interruption state from LiveKit
# This is set by the playback_finished event listener in worker.py
_interruption_detected = False


def set_interruption_detected(value: bool) -> None:
    """Set the interruption detected flag (called from worker.py)."""
    global _interruption_detected
    _interruption_detected = value


def get_interruption_detected() -> bool:
    """Get the interruption detected flag."""
    return _interruption_detected


class InterruptionEvent(BaseEvent):
    """
    Event that triggers when the counselor interrupts the agent while speaking.

    This event uses LiveKit's built-in interruption detection via the
    playback_finished event, which provides accurate interruption detection.

    Detection Logic:
    - Uses LiveKit's playback_finished event with interrupted flag
      (set by worker.py when LiveKit detects an interruption)
    - No fallback methods - relies solely on LiveKit's native detection
    """

    detection_type: DetectionType = DetectionType.HELPER_INTERRUPTED
    data: InterruptionData = InterruptionData()

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: InterruptionData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.HELPER_INTERRUPTED,
        **kwargs,
    ) -> "InterruptionEvent":
        """
        Create an InterruptionEvent with typed data.

        Args:
            event_id: Event identifier
            data: InterruptionData instance (currently no data needed)
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to HELPER_INTERRUPTED)
            **kwargs: Other BaseEvent fields (score, emoji, show_feedback, etc.)
        """
        return cls.model_construct(
            event_id=event_id,
            visibility_type=visibility_type,
            detection_type=detection_type,
            data=data,
            **kwargs,
        )

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detect if the counselor interrupted the agent.

        This event uses LiveKit's built-in interruption detection via the
        playback_finished event. The interruption state is stored in a module-level
        variable and checked here.

        Detection Logic:
        - Checks if interruption flag is set (from LiveKit's playback_finished event)
        - No fallback methods - relies solely on LiveKit's native detection

        Args:
            conversations: List of chat messages (not used, kept for
                interface compatibility)

        Returns:
            True if an interruption is detected, False otherwise
        """
        # Check LiveKit interruption flag
        # This is set by the playback_finished event listener in worker.py
        global _interruption_detected
        if _interruption_detected:
            # Reset the flag after checking (one-time use)
            _interruption_detected = False
            return True

        return False
