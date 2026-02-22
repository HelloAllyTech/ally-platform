"""
Time-based event detection.
"""

from typing import List

from typing_extensions import override

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.time.constants import TimeData


class TimeEvent(BaseEvent):
    """
    Event that triggers based on elapsed time in the conversation.
    """

    detection_type: DetectionType = DetectionType.TIME
    data: TimeData = TimeData(time=0.0, condition=ConditionOperator.LTE)

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: TimeData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.TIME,
        **kwargs,
    ) -> "TimeEvent":
        """
        Create a TimeEvent with typed data.

        Args:
            event_id: Event identifier
            data: TimeData instance
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to TIME)
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
        Detect if the time condition is met.

        Note: This requires access to conversation start time or elapsed time,
        which is not available in the current detect_event signature.
        For now, this is a placeholder that returns False.
        TODO: Update to accept state or elapsed time parameter.
        """
        # Placeholder: actual implementation needs elapsed time
        # elapsed_time = get_elapsed_time(conversations)
        # return evaluate_condition(elapsed_time, self.data.condition, self.data.time)
        return False
