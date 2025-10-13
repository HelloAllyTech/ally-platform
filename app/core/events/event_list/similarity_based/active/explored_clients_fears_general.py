from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import EXPLORE_CLIENT_FEARS_GENERAL

_EXPLORED_CLIENTS_FEARS_GENERAL_SENTENCES: Sequence[str] = [
    "What specifically about the future worries you the most?",
    "Can you pinpoint the scenario you're imagining that feels stressful?",
    "What part of the upcoming situation feels hardest for you?",
    "Which outcome are you most concerned might happen?",
    "Can you describe exactly what you fear could go wrong?",
    "Which possibility is creating the most anxiety for you?",
    "What specific event are you imagining that triggers this worry?",
    "Can you narrow down what you're most concerned about?",
    "What does the future look like in your mind when you feel anxious?",
    "Which aspect of what's coming up feels most threatening?",
    "Can you identify a concrete situation you're worried about?",
    "What detail of the upcoming event feels the most overwhelming?",
    "Which part of the future scenario worries you most?",
    "Can you describe the specific outcome that scares you?",
    "What exactly are you anticipating that feels stressful?",
    "Which possibility seems most likely to cause problems?",
    "Can you break down the part of the future that feels hardest to face?",
    "What do you imagine happening that worries you the most?",
    "Which step ahead feels most uncertain or unsafe?",
    "Can you point to a particular situation or moment you're anxious about?",
    "Which detail of what's coming up do you find most concerning?",
    "What specifically keeps replaying in your mind about the future?",
    "Which part of what might happen feels most uncontrollable?",
    "Can you describe the scenario that triggers your anxiety most strongly?",
    "What outcome are you trying to prepare for?",
    "Which potential event ahead is occupying your thoughts the most?",
    "Can you tell me the specific thing that worries you about next week/month/year?",
    "What's the first image or thought that comes to mind when you think about the future?",
    "Which part of the situation feels most challenging to you?",
    "Can you identify the specific moment you're anxious about?"
]


@register_event
class CareAgentExploredClientsFearsGeneralEvent(SimilarityBaseEvent):
    """Event for exploring client's fears"""
    event_id = EXPLORE_CLIENT_FEARS_GENERAL
    similar_sentences = _EXPLORED_CLIENTS_FEARS_GENERAL_SENTENCES
