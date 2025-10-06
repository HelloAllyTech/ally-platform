from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import NORMALIZE_EXPERIENCE

_NORMALISED_EXPERIENCE_SENTENCES: Sequence[str] = [
    "Many people feel that way in situations like yours.",
    "It's actually very normal to react like this.",
    "You're not alone in feeling that way.",
    "Lots of people struggle with similar thoughts.",
    "Many clients I see have gone through something like this.",
    "It's common to feel anxious when facing uncertainty.",
    "Most people would have a hard time with that.",
    "What you're experiencing is a normal human response.",
    "Others in your position might feel the same way.",
    "It's typical to feel sadness after a loss like this.",
    "Fear in situations like that is completely normal.",
    "You're not the only one who has gone through this.",
    "Lots of people have similar worries.",
    "Your reaction is more common than you might think.",
    "It's normal to feel conflicted about that.",
    "Many people would feel disappointed in your shoes.",
    "What you're describing happens to a lot of people.",
    "It's not unusual at all to feel this way.",
    "You're not strange or broken for having these feelings.",
    "Others often find themselves reacting just like that.",
    "This is a very human experience.",
    "You'd be surprised how many people feel the same way.",
    "Your thoughts are more common than you realize.",
    "It's normal to feel overwhelmed when so much is happening.",
    "People often have the same fear in that situation.",
    "Your reaction makes sense and isn't unusual.",
    "Many people struggle with these kinds of doubts.",
    "It's a shared human experience to feel this way.",
    "Nothing you've said is outside the range of normal.",
    "You're not the only one who has ever felt like this."
]


@register_event
class CareAgentNormalisedSubjectiveExperienceEvent(SimilarityBaseEvent):
    """Event for normalising subjective experience"""
    event_id = NORMALIZE_EXPERIENCE
    similar_sentences = _NORMALISED_EXPERIENCE_SENTENCES
