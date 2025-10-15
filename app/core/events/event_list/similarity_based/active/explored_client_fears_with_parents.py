from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import EXPLORE_CLIENT_FEARS_WITH_PARENTS

_EXPLORED_CLIENTS_FEARS_WITH_PARENTS_SENTENCES: Sequence[str] = [
    "What about talking with your parents feels most frightening to you?",
    "Can you describe the fear that comes up when you think about speaking with your parents?",
    "What are you imagining might happen during a conversation with your parents?",
    "How does your body respond when you think about confronting your parents?",
    "What thoughts come up when you anticipate a discussion with your parents?",
    "Which parts of talking with your parents worry you the most?",
    "Can you tell me what scares you about your parents' possible reactions?",
    "How likely do you think the outcomes you fear from your parents are?",
    "What would the worst-case scenario look like with your parents?",
    "Which of your concerns about your parents feels strongest right now?",
    "Can you separate what you fear from what you actually expect from your parents?",
    "What emotions arise when you think about what you might say to your parents?",
    "Can you pinpoint the exact part of the conversation with your parents that triggers fear?",
    "How do you imagine your parents might respond, and how does that feel?",
    "What are you most anxious about your parents hearing or understanding?",
    "How does this fear affect your willingness to speak with your parents?",
    "Can you describe the thought about your parents that scares you the most?",
    "What would make talking with your parents feel safer for you?",
    "Which past experiences with your parents make you nervous about talking to them?",
    "What's the first thing that comes to mind when you imagine talking with your parents?",
    "How intense does this fear of your parents feel on a scale from 1 to 10?",
    "Can you tell me what you're most afraid of losing in your interaction with your parents?",
    "What would need to happen for your fear of talking with your parents to decrease?",
    "How do you imagine handling your parents' potential reactions?",
    "What patterns in your parents' behavior trigger your fear?",
    "Can you describe what you fear happening emotionally during a conversation with your parents?",
    "How does thinking about your parents affect your day-to-day life?",
    "What would be the most difficult part of talking with your parents for you?",
    "Which expectations about your parents feel unrealistic or particularly stressful?",
    "What kind of support would make talking with your parents easier?"
]


@register_event
class CareAgentExploredClientsFearsWithParentsEvent(SimilarityBaseEvent):
    """Event for exploring client's fears"""
    event_id = EXPLORE_CLIENT_FEARS_WITH_PARENTS
    similar_sentences = _EXPLORED_CLIENTS_FEARS_WITH_PARENTS_SENTENCES
