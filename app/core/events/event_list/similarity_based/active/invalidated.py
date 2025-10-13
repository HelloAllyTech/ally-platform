from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import INVALIDATE

_INVALIDATED_SENTENCES: Sequence[str] = [
    "You're overreacting.",
    "It's not that big of a deal.",
    "You're too sensitive.",
    "You shouldn't feel that way.",
    "Just forget about it and move on.",
    "That doesn't sound like something worth being upset over.",
    "Why can't you just let it go?",
    "Other people have it worse.",
    "You shouldn't be angry about that.",
    "You're making a mountain out of a molehill.",
    "That's irrational.",
    "You're thinking about this too much.",
    "Stop dwelling on the past.",
    "You don't really mean that.",
    "You'll be fine, it's nothing.",
    "That's just in your head.",
    "It's silly to feel that way.",
    "You're too emotional.",
    "There's no reason to cry.",
    "You're exaggerating."
]


@register_event
class CareAgentInvalidatedEvent(SimilarityBaseEvent):
    """Event for invalidating client"""
    event_id = INVALIDATE
    similar_sentences = _INVALIDATED_SENTENCES
