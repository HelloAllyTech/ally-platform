from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import EXPLORE_IMPACT_OF_PROBLEM

_EXPLORED_IMPACT_OF_PROBLEM_SENTENCES: Sequence[str] = [
    "How has this problem affected your day-to-day life?",
    "What impact is this having on your relationships?",
    "In what ways has this issue influenced your mood or emotions?",
    "How does this problem affect your sense of self?",
    "What areas of your life feel most disrupted by this?",
    "Can you describe how this issue has shaped your routines?",
    "How has this problem affected your work or school life?",
    "What impact does this have on your ability to enjoy things you normally like?",
    "Have you noticed changes in your energy or motivation because of this?",
    "How does this issue influence your interactions with others?",
    "What effect does this problem have on your confidence or self-esteem?",
    "How has this problem affected your physical well-being?",
    "In what ways has it affected your decision-making?",
    "How does this problem impact your ability to feel safe or secure?",
    "What aspects of your life feel most constrained by this issue?",
    "How does this problem show up in your daily routine?",
    "What emotions are stirred up most by this issue?",
    "How has it affected your relationships with family or friends?",
    "In what ways does this problem limit your opportunities or choices?",
    "How do you feel when this problem interferes with your goals?",
    "What areas of your life have been most disrupted?",
    "How does this issue influence your sense of control or autonomy?",
    "What patterns have emerged because of this problem?",
    "How does this affect your ability to focus or concentrate?",
    "In what ways has this problem affected your overall well-being?",
    "What impact does this have on your social life or support network?",
    "How do you feel about the ways this problem has shaped your life?",
    "What challenges have come up because of this issue?",
    "How does this problem affect your ability to cope with stress?",
    "What changes have you noticed in your life since this problem began?",
]


@register_event
class ExploredImpactOfProblemEvent(SimilarityBaseEvent):
    """Event for exploring impact of the problem"""
    event_id = EXPLORE_IMPACT_OF_PROBLEM
    similar_sentences = _EXPLORED_IMPACT_OF_PROBLEM_SENTENCES
