from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import IRRELEVANT_ASSURANCE

_OFFERED_IRRELEVANT_ASSURANCE_SENTENCES: Sequence[str] = [
    "I know you can handle this.",
    "Don't worry, everything will be fine.",
    "You'll get over it soon.",
    "You're stronger than you think.",
    "You'll forget about this eventually.",
    "At least you're not as bad off as some people.",
    "You just need to stay positive.",
    "You'll laugh about this one day.",
    "Time heals all wounds.",
    "You'll find someone better.",
    "It's probably not as serious as you think.",
    "You're young, you have plenty of time.",
    "Things have a way of working out.",
    "You'll look back and see this wasn't a big deal.",
    "Everything happens for a reason.",
    "God (or the universe) wouldn't give you more than you can handle.",
    "You're too smart to let this bother you.",
    "You're a survivor—you'll be fine.",
    "You just need to trust the process.",
    "It could be worse.",
    "You've gotten through hard things before, you'll get through this too.",
    "You'll be okay, don't overthink it.",
    "This will make you stronger.",
    "Don't worry so much, you'll see it's not a problem.",
    "You're resilient, you'll bounce back quickly.",
    "Other people have overcome worse.",
    "You'll feel better tomorrow.",
    "You just need to keep busy and it won't bother you.",
    "You're tougher than you realize.",
    "Someday you'll thank yourself for going through this.",
    "You'll be fine as long as you don't dwell on it.",
    "Don't stress, you'll figure it out.",
    "You'll laugh about this later.",
    "It's not worth worrying about.",
    "You're making too big a deal out of this."
]


@register_event
class OfferedIrrelevantAssuranceEvent(SimilarityBaseEvent):
    """Event for offering irrelevant assurance"""
    event_id = IRRELEVANT_ASSURANCE
    similar_sentences = _OFFERED_IRRELEVANT_ASSURANCE_SENTENCES
