from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import SCALING_QUESTIONS

_USED_SCALING_QUESTIONS_TO_ASSESS_INTENSITY_SENTENCES: Sequence[str] = [
    "on a scale of 1-10, where 1 is less fear and 10 is extreme fear, where would you rate yours?"
]


@register_event
class UsedScalingQuestionsToAssessIntensityEvent(SimilarityBaseEvent):
    """Event for using scaling questions to assess intensity"""
    event_id = SCALING_QUESTIONS
    similar_sentences = _USED_SCALING_QUESTIONS_TO_ASSESS_INTENSITY_SENTENCES
