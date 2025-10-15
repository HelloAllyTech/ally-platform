from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import ENHANCE_SUPPORT_SYSTEMS

_ENHANCED_SUPPORT_SYSTEMS_SENTENCES: Sequence[str] = [
    "Can you identify a few people who can be of support during this time?"
]


@register_event
class EnhancedSupportSystemsEvent(SimilarityBaseEvent):
    """Event for enhancing support systems"""
    event_id = ENHANCE_SUPPORT_SYSTEMS
    similar_sentences = _ENHANCED_SUPPORT_SYSTEMS_SENTENCES
