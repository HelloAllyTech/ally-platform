"""
Score-based event detection.
"""

from typing import List

from typing_extensions import override

from app.core.constants import ConditionOperator, DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.score.constants import ScoreData


class ScoreEvent(BaseEvent):
    """
    Event that triggers based on current cumulative score.
    """

    detection_type: DetectionType = DetectionType.SCORE
    data: ScoreData = ScoreData(score=0, condition=ConditionOperator.GT)

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: ScoreData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.SCORE,
        **kwargs,
    ) -> "ScoreEvent":
        """
        Create a ScoreEvent with typed data.

        Args:
            event_id: Event identifier
            data: ScoreData instance
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to SCORE)
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
        Detect if the score condition is met.

        Note: This requires access to current cumulative score,
        which is not available in the current detect_event signature.
        For now, this is a placeholder that returns False.
        TODO: Update to accept state or current_score parameter.
        """
        # Placeholder: actual implementation needs current score
        # current_score = get_current_score()
        # return evaluate_condition(current_score, self.data.condition, self.data.score)
        return False
