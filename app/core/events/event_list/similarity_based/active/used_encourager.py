from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import ENCOURAGER

_ENCOURAGER_SENTENCES: Sequence[str] = [
    "Mhm.",
    "Uh-huh.",
    "Go on.",
    "Tell me more about that.",
    "Keep talking.",
    "I hear you.",
    "Okay…",
    "And then?",
    "Right.",
    "Yes.",
    "Hmm.",
    "Say more.",
    "I see.",
    "Uh-huh, uh-huh.",
    "Mm.",
    "Go ahead.",
    "Keep going.",
    "I'm listening.",
    "Sure.",
    "Mmhm.",
    "What else?",
    "Uh-huh, yeah.",
    "Go ahead, I'm with you.",
    "Mm, okay.",
    "Tell me more.",
    "Uh-huh, I get it.",
    "Keep sharing.",
    "Right, right.",
    "Mm, I understand."
]


@register_event
class CareAgentUsedEncouragerEvent(SimilarityBaseEvent):
    """Event for care agent used encourager"""
    event_id = ENCOURAGER
    similar_sentences = _ENCOURAGER_SENTENCES
