from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import ASSUMPTIONS

_EXPRESSED_ASSUMPTION_ABOUT_CLIENT_AGENT_SENTENCES: Sequence[str] = [
    "You must be depressed.",
    "I'm sure your parents didn't mean to hurt you.",
    "You probably feel angry about that.",
    "You don't want to change, do you?",
    "You must be anxious in social situations.",
    "You're only upset because of work stress.",
    "I can tell you're in denial.",
    "You must want to end this relationship.",
    "You're clearly not trying hard enough.",
    "You're only saying that because you're scared.",
    "I know what you're really feeling.",
    "You must be lonely.",
    "You're just projecting your feelings onto others.",
    "You must regret that decision.",
    "I can tell you don't believe in yourself.",
    "You're only here because someone pushed you to come.",
    "You must be angry at your father.",
    "I'm sure deep down you know the answer.",
    "You're not really that sad, just tired.",
    "You must want to quit your job."
]


@register_event
class CareAgentExpressedAssumptionAboutClientAgentEvent(SimilarityBaseEvent):
    """Event for expressing assumption about client agent"""
    event_id = ASSUMPTIONS
    similar_sentences = _EXPRESSED_ASSUMPTION_ABOUT_CLIENT_AGENT_SENTENCES
