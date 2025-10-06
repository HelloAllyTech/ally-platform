from typing import List, override

from app.core.events.base import BaseEvent, ChatMessage
from app.core.events.registry import register_event


@register_event
class CounselorRephrasedEvent(BaseEvent):
    event_id = "counselor-rephrased"

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Simple heuristic: counselor's last message is "long enough"
        Replace with actual rephrase detection later (e.g., similarity to user's last message).
        """
        if not conversations:
            return False
        last = conversations[-1]
        return len(last.content.strip()) > 10


@register_event
class CounselorSaidNegativeEvent(BaseEvent):
    event_id = "counselor-said-negative"

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detect if counselor used negative words.
        """
        if not conversations:
            return False
        last = conversations[-1]

        content = last.content.lower()
        negative_words = {"die", "suicide", "kill"}
        return any(w in content for w in negative_words)


@register_event
class CounselorGreetedEvent(BaseEvent):
    event_id = "counselor-greeted"

    @override
    async def detect_event(self, conversations: List[ChatMessage]) -> bool:
        """
        Detect counselor greeting.
        """
        if not conversations:
            return False
        last = conversations[-1]

        content = last.content.lower()
        greeted_words = {"hello", "hi", "hey"}
        return any(word in content for word in greeted_words)
