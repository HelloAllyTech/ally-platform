from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import MIRACLE_QUESTIONING

_USED_MIRACLE_QUESTIONING_SENTENCES: Sequence[str] = [
    "If you were to wake up tomorrow and things were the way you liked, what would be different?"
]


@register_event
class UsedMiracleQuestioningEvent(SimilarityBaseEvent):
    """Event for using miracle questioning"""
    event_id = MIRACLE_QUESTIONING
    similar_sentences = _USED_MIRACLE_QUESTIONING_SENTENCES
