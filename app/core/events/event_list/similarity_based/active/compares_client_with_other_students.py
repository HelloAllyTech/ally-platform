from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import COMPARE_STUDENTS

_COMPARES_CLIENT_WITH_OTHER_STUDENTS_SENTENCES: Sequence[str] = [
    "Most students your age manage this better.",
    "Other students don't get this anxious about exams.",
    "Plenty of people go through worse with their families.",
    "Your classmates don't seem to have these problems.",
    "Everyone struggles in school of college—you're not different.",
    "Other students figure out how to cope, you should too.",
    "Most people your age can handle pressure without breaking down.",
    "Your peers don't find it as hard to balance work and studies.",
    "Lots of students come here with bigger challenges.",
    "Other students don't take things so personally."
]


@register_event
class CareAgentComparesClientWithOtherStudentsEvent(SimilarityBaseEvent):
    """Event for comparing client with other students"""
    event_id = COMPARE_STUDENTS
    similar_sentences = _COMPARES_CLIENT_WITH_OTHER_STUDENTS_SENTENCES
