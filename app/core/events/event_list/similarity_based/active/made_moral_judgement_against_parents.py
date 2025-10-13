from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import MORAL_JUDGMENT_PARENTS

_MADE_MORAL_JUDGEMENT_AGAINST_PARENTS_SENTENCES: Sequence[str] = [
    "Your parents have really messed you up.",
    "It's obvious your parents don't care about you.",
    "You parents are toxic, you should cut ties.",
    "Your parents don't love you the way they should.",
    "It's clear your parents are the main reason you have these issues.",
    "You'd be better off without your parents in your life.",
    "Your family has failed you completely.",
    "Your parents don't want what's best for you.",
    "It's not worth trying to have a relationship with your parents.",
    "Your parents are the problem here, not you."
]


@register_event
class CareAgentMadeMoralJudgementAgainstParentsEvent(SimilarityBaseEvent):
    """Event for making moral judgement against parents"""
    event_id = MORAL_JUDGMENT_PARENTS
    similar_sentences = _MADE_MORAL_JUDGEMENT_AGAINST_PARENTS_SENTENCES
