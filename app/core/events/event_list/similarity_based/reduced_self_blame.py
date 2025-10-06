from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import REDUCE_SELF_BLAME

_REDUCED_SELF_BLAME_SENTENCES: Sequence[str] = [
    "It's understandable that this happened, and it's not entirely your fault.",
    "Let's separate what was in your control from what wasn't.",
    "You're taking a lot of responsibility for things that weren't yours to control.",
    "Try to recognize the factors outside of your influence.",
    "Would it help to consider other people or circumstances that contributed?",
    "Blaming yourself won't change the outcome, but understanding context can help.",
    "You did the best you could with the information you had at the time.",
    "Let's explore where responsibility realistically lies.",
    "Self-blame can be heavy — let's look at it more objectively.",
    "You're not solely responsible for what happened.",
    "It's okay to acknowledge your part without taking all the blame.",
    "Let's identify what you can learn from this rather than blaming yourself.",
    "Other people's actions played a role, too.",
    "You're human, and mistakes or missteps don't define you.",
    "Try noticing how much of this outcome was beyond your control.",
    "It's natural to feel responsible, but the situation is more complex.",
    "You're carrying more blame than is fair to yourself.",
    "Let's reframe this in terms of growth instead of fault.",
    "You can recognize your feelings without labeling yourself at fault.",
    "External circumstances contributed, and that's important to acknowledge.",
    "Try to show yourself the same compassion you would show a friend.",
    "You did what you could, and it's unfair to blame yourself entirely.",
    "Let's separate guilt from learning opportunities.",
    "You're not defective or bad because this happened.",
    "Other factors were involved, not just your actions.",
    "Self-blame can obscure the real sources of the problem.",
    "You can take responsibility where it's realistic without overburdening yourself.",
    "Let's identify where responsibility truly lies, without self-judgment.",
    "You're allowed to make mistakes without blaming yourself excessively.",
    "Try seeing this situation from a more balanced perspective.",
    "Let's notice how self-blame affects your mood and choices.",
]


@register_event
class ReducedSelfBlameEvent(SimilarityBaseEvent):
    """Event for reducing self-blame"""
    event_id = REDUCE_SELF_BLAME
    similar_sentences = _REDUCED_SELF_BLAME_SENTENCES
