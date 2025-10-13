from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import CLOSE_SESSION

_CLOSED_SESSION_EFFECTIVELY_SENTENCES: Sequence[str] = [
    "Before we end, what are you taking away from our session today?"
]


@register_event
class ClosedSessionEffectivelyEvent(SimilarityBaseEvent):
    """Event for closing session effectively"""
    event_id = CLOSE_SESSION
    similar_sentences = _CLOSED_SESSION_EFFECTIVELY_SENTENCES
