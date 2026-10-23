"""
Combination event detection based on logical expressions of other events.
"""

from typing import List

from typing_extensions import override

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.combination.constants import (
    CombinationData,
    ExpressionNode,
)


class CombinationEvent(BaseEvent):
    """
    Event that triggers based on a logical combination of other events.
    """

    detection_type: DetectionType = DetectionType.COMBINATION
    data: CombinationData = CombinationData(
        dependent_events=[], expression=ExpressionNode(type="IDENTIFIER", id="")
    )

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: CombinationData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.COMBINATION,
        **kwargs,
    ) -> "CombinationEvent":
        """
        Create a CombinationEvent with typed data.

        Args:
            event_id: Event identifier
            data: CombinationData instance
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to COMBINATION)
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
        Detect if the combination expression evaluates to true.

        Note: This requires access to detected events from the current turn,
        which is not available in the current detect_event signature.
        For now, this is a placeholder that returns False.
        TODO: Update to accept detected_events or state parameter.
        """
        # Placeholder: actual implementation needs detected events
        # detected_event_ids = get_detected_event_ids()
        # return evaluate_expression(self.data.expression, detected_event_ids)
        return False
