from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import RECOGNIZE_WORRY_FUTURE

_RECOGNISED_WORRY_ABOUT_FUTURE_SENTENCES: Sequence[str] = [
    "What are your worries about the future?"
]


@register_event
class CareAgentRecognisedWorryAboutFutureEvent(SimilarityBaseEvent):
    """Event for recognising worry about future"""
    event_id = RECOGNIZE_WORRY_FUTURE
    similar_sentences = _RECOGNISED_WORRY_ABOUT_FUTURE_SENTENCES
