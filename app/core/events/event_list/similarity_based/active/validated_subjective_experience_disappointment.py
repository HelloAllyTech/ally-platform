from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import VALIDATE_DISAPPOINTMENT

_VALIDATED_DISAPPOINTMENT_SENTENCES: Sequence[str] = [
    "It makes sense that you feel disappointed.",
    "Of course you'd feel let down after that.",
    "I can see why that would be disappointing for you.",
    "Your disappointment is valid — it reflects how much this mattered to you.",
    "It's natural to feel disappointed when things don't turn out as hoped.",
    "Anyone in your position might feel the same sense of letdown.",
    "You invested a lot in this, so of course the outcome feels disappointing.",
    "It's understandable that you were hoping for more.",
    "Your disappointment shows how much you cared about this.",
    "I hear the sense of letdown you're carrying.",
    "Of course you're disappointed — you were counting on that.",
    "It makes sense that you feel let down given the effort you put in.",
    "That disappointment is real, and it matters.",
    "Your feelings of disappointment are completely valid.",
    "I can see how much you wanted this to go differently.",
    "It's understandable that this feels like a letdown.",
    "Of course you're disappointed — your expectations were reasonable.",
    "That sense of disappointment shows the importance this had for you.",
    "It's natural to feel let down in this situation.",
    "I hear how disappointing that was for you.",
    "Your disappointment is an understandable response.",
    "It makes sense that you feel let down by that outcome.",
    "You had good reasons to expect more, so of course this feels disappointing.",
    "That disappointment is real, and I want to honor it.",
    "It's valid to feel let down after putting so much into this.",
    "I can understand why this feels like such a disappointment.",
    "Of course you're feeling a sense of letdown right now.",
    "Your disappointment is a natural reaction to what happened.",
    "It makes sense that this didn't meet your hopes.",
    "I hear the weight of that disappointment for you."
]


@register_event
class CareAgentValidatedSubjectiveExperienceDisappointmentEvent(SimilarityBaseEvent):
    """Event for validating subjective experience disappointment"""
    event_id = VALIDATE_DISAPPOINTMENT
    similar_sentences = _VALIDATED_DISAPPOINTMENT_SENTENCES
