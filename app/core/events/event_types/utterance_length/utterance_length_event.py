"""
Utterance length-based event detection.
Tracks the length of counselor/helper utterances.
"""

from typing import List

from typing_extensions import override

from app.core.constants import DetectionType
from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.event_types.utterance_length.constants import UtteranceLengthData


class UtteranceLengthEvent(BaseEvent):
    """
    Event that triggers based on the character length of counselor utterances.

    This event detects when the counselor's (helper's) message length falls
    within a specified range. It checks the most recent counselor message.
    """

    detection_type: DetectionType = DetectionType.HELPER_UTTERANCE_LENGTH
    data: UtteranceLengthData = UtteranceLengthData(min_utterance_length=0)

    @classmethod
    def create(
        cls,
        *,
        event_id: str,
        data: UtteranceLengthData,
        visibility_type=None,
        detection_type: DetectionType = DetectionType.HELPER_UTTERANCE_LENGTH,
        **kwargs,
    ) -> "UtteranceLengthEvent":
        """
        Create an UtteranceLengthEvent with typed data.

        Args:
            event_id: Event identifier
            data: UtteranceLengthData instance with
            minUtteranceLength and/or maxUtteranceLength
            visibility_type: Visibility type (optional)
            detection_type: Detection type (defaults to HELPER_UTTERANCE_LENGTH)
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
        Detect if the most recent counselor message length matches the criteria.

        Checks the last message in the conversation. If it's from the counselor,
        checks if its character length falls within the specified range.

        Args:
            conversations: List of chat messages

        Returns:
            True if the most recent counselor message length matches, False otherwise
        """
        if not conversations:
            return False

        # Get the most recent message
        last_message = conversations[-1]

        # Only check counselor messages
        # Note: role can be "counselor" (from convert_messages_to_chat_messages)
        # or "COUNSELOR" (from event_handler), so we check case-insensitively
        if last_message.role.lower() != "counselor":
            return False

        # Get the character length of the message
        message_length = len(last_message.content) if last_message.content else 0

        # Check if length is within the specified range
        min_len = (
            self.data.min_utterance_length
            if self.data.min_utterance_length is not None
            else 0
        )
        if message_length < min_len:
            return False
        if (
            self.data.max_utterance_length is not None
            and message_length > self.data.max_utterance_length
        ):
            return False
        return True
