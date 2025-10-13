from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import OFFER_COLLABORATION

_OFFERED_COLLABORATION_SENTENCES: Sequence[str] = [
    "Let's figure this out together.",
    "How about we come up with a plan as a team?",
    "What do you think would be most helpful for us to focus on?",
    "Would you like to set the agenda for today's session?",
    "Let's explore the options and decide together what feels right.",
    "What feels like the best next step to you?",
    "Would you like to try this approach, or does something else feel better?",
    "Let's build some goals that make sense to both of us.",
    "How does this idea sound to you?",
    "Shall we check in regularly to see if this direction is still working for you?",
    "Let's adjust the pace in a way that feels comfortable for you.",
    "What role would you like me to play as we work on this?",
    "Would you like me to suggest strategies, or do you prefer we brainstorm them together?",
    "Let's co-create a plan that feels doable.",
    "How can we make this process fit your life better?",
    "Would you like to try this out between sessions, or would you prefer we keep it in-session for now?",
    "Let's see what's most important to you and work from there.",
    "What would collaboration look like for you here?",
    "Would you be open to experimenting with this, and then we can reflect on how it went?",
    "Let's make adjustments together as we go.",
    "Do you want to lead the direction of this topic, or would you like me to?",
    "Let's check in about what's working and what's not.",
    "How do you feel about balancing my suggestions with your own ideas?",
    "Would you like me to share some options, and then we can choose together?",
    "Let's create strategies that fit with your strengths.",
    "What kind of support do you want from me as we work through this?",
    "Would you like to focus more on reflection, or more on action, as we move forward?",
    "Let's decide together how much homework, if any, feels useful.",
    "How can we shape this process so it works best for you?",
    "Would you like me to guide more here, or to step back so you lead?"
]


@register_event
class CareAgentOfferedCollaborationEvent(SimilarityBaseEvent):
    """Event for offering collaboration"""
    event_id = OFFER_COLLABORATION
    similar_sentences = _OFFERED_COLLABORATION_SENTENCES
