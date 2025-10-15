from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import MAKE_ABOUT_SELF

_MADE_IT_ABOUT_THEMSELVES_SENTENCES: Sequence[str] = [
    "I had a similar problem, I handled it much better.",
    "When I went through this, I felt the same way.",
    "I also struggle with anxiety sometimes.",
    "Hearing this makes me really sad.",
    "I feel so frustrated when you say that.",
    "Do you think I'm helping you enough?",
    "I hope you don't see me as being too pushy.",
    "I had such a stressful week myself.",
    "I think the way society works these days is the real problem.",
    "You remind me of how I was at your age.",
    "I used to be just like you."
]


@register_event
class MadeItAboutThemselvesEvent(SimilarityBaseEvent):
    """Event for making it about themselves"""
    event_id = MAKE_ABOUT_SELF
    similar_sentences = _MADE_IT_ABOUT_THEMSELVES_SENTENCES
