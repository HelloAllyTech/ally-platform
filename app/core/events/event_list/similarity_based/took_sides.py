from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import TAKE_SIDES

_TOOK_SIDES_SENTENCES: Sequence[str] = [
    "Your parents are right, studies matter.",
    "This is your fault.",
    "Your parents did the best they could.",
    "You should be more grateful for what they gave you.",
    "Parents always want what's best for their children.",
    "You're being too hard on them.",
    "They probably didn't mean to hurt you.",
    "You're exaggerating what happened.",
    "Your mom/dad was only trying to protect you.",
    "You should cut them some slack.",
    "They had good intentions.",
    "You need to forgive them and move on.",
    "They must have had their reasons.",
    "Every parent makes mistakes, yours are no different.",
    "You're only remembering the bad parts.",
    "They were stricter because they loved you.",
    "Your parents sacrificed a lot for you.",
    "You shouldn't question their authority.",
    "They didn't know any better at the time.",
    "You're misinterpreting what they did.",
    "Deep down, they love you.",
    "You'll understand them better when you're older.",
    "Your parents couldn't have been that bad.",
    "They wanted to toughen you up.",
    "You're holding a grudge.",
    "They just wanted you to succeed.",
    "Maybe you're being unfair to them.",
    "You should respect them more.",
    "Your parents were only human.",
    "They never intended to cause harm.",
    "You're focusing too much on their flaws.",
    "Maybe you misunderstood what they were trying to do.",
    "Your parents did what any parent would have done."
]


@register_event
class TookSidesEvent(SimilarityBaseEvent):
    """Event for taking sides"""
    event_id = TAKE_SIDES
    similar_sentences = _TOOK_SIDES_SENTENCES
