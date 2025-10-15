from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import FOCUS_STRENGTH

_FOCUSED_ON_STRENGTH_SENTENCES: Sequence[str] = [
    "You've shown a lot of resilience in getting through this.",
    "It sounds like you've found ways to cope, even when things were tough.",
    "You're resourceful — you've managed so much already.",
    "It took courage to come here and talk about this.",
    "You've handled difficult situations before, and that strength is still with you.",
    "You have a lot of insight into your own patterns.",
    "You care deeply about the people in your life — that's a strength.",
    "You've already survived so much.",
    "Your persistence is really clear here.",
    "You show a lot of commitment to your growth.",
    "You've taken important steps by seeking help.",
    "You have strong values guiding you.",
    "You've been creative in finding ways to get through.",
    "Your honesty with yourself is a powerful strength.",
    "You've demonstrated bravery in sharing this with me.",
    "You've built skills over time that we can lean on now.",
    "You're clearly motivated to make changes.",
    "You show self-awareness that will help you move forward.",
    "You've held onto hope even when things were hard.",
    "You have a lot of compassion, even for others who've hurt you.",
    "You've been able to adapt to so many challenges.",
    "Your determination really stands out.",
    "You've already made progress, which shows your strength.",
    "You have a strong sense of responsibility.",
    "You've been protecting yourself the best way you knew how.",
    "You've shown persistence in coming back week after week.",
    "Your ability to reflect is one of your strengths.",
    "You've demonstrated a lot of patience with yourself.",
    "You've carried a lot on your own — that shows your strength.",
    "Your openness to learning is a real asset here."
]


@register_event
class CareAgentFocusedOnStrengthEvent(SimilarityBaseEvent):
    """Event for focusing on strength"""
    event_id = FOCUS_STRENGTH
    similar_sentences = _FOCUSED_ON_STRENGTH_SENTENCES
