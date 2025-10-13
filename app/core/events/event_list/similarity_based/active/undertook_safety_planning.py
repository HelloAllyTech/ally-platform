from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import SAFETY_PLANNING

_UNDERTOOK_SAFETY_PLANNING_SENTENCES: Sequence[str] = [
    "If you feel unsafe later, what can be done to ensure safety?"
]


@register_event
class UndertookSafetyPlanningEvent(SimilarityBaseEvent):
    """Event for undertaking safety planning"""
    event_id = SAFETY_PLANNING
    similar_sentences = _UNDERTOOK_SAFETY_PLANNING_SENTENCES
