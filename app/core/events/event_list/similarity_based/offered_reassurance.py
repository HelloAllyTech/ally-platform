from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import OFFER_REASSURANCE

_OFFERED_REASSURANCE_SENTENCES: Sequence[str] = [
    "I am here with you",
    "I assure you of my support",
    "You are not alone in this"
]


@register_event
class OfferedReassuranceEvent(SimilarityBaseEvent):
    """Event for offering reassurance"""
    event_id = OFFER_REASSURANCE
    similar_sentences = _OFFERED_REASSURANCE_SENTENCES
