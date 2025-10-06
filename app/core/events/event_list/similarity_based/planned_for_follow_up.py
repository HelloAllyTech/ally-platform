from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import PLAN_FOLLOW_UP

_PLANNED_FOR_FOLLOW_UP_SENTENCES: Sequence[str] = [
    "We have diccused multiple ways of addressing this challenge, in our next conversation we can assess progress."
]


@register_event
class PlannedForFollowUpEvent(SimilarityBaseEvent):
    """Event for planning for follow up"""
    event_id = PLAN_FOLLOW_UP
    similar_sentences = _PLANNED_FOR_FOLLOW_UP_SENTENCES
