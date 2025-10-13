from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import SOLUTION_FOCUSED_THINKING

_ENCOURAGED_IN_SOLUTION_FOCUSED_THINKING_SENTENCES: Sequence[str] = [
    "What are some ways to address this situation?"
]


@register_event
class EncouragedInSolutionFocusedThinkingEvent(SimilarityBaseEvent):
    """Event for encouraging in solution focused thinking"""
    event_id = SOLUTION_FOCUSED_THINKING
    similar_sentences = _ENCOURAGED_IN_SOLUTION_FOCUSED_THINKING_SENTENCES
