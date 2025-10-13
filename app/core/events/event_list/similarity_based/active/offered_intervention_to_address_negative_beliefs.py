from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import NEGATIVE_BELIEFS_INTERVENTION

_OFFERED_INTERVENTION_TO_ADDRESS_NEGATIVE_BELIEFS_SENTENCES: Sequence[str] = [
    "Let's examine the evidence for and against that belief.",
    "Can we identify times when this belief hasn't been true?",
    "Would it help to reframe that thought in a more balanced way?",
    "Let's try to notice when this negative belief pops up and label it as just a thought.",
    "Have you considered alternative explanations for what happened?",
    "Let's write down your negative beliefs and test them against reality.",
    "Would it help to track situations where this belief affects your behavior?",
    "Let's explore whether this belief is coming from past experiences rather than current facts.",
    "Try challenging this thought by asking yourself what you would say to a friend.",
    "Let's practice replacing this negative belief with a more constructive statement.",
    "Would it help to notice patterns when this belief appears?",
    "Let's identify evidence that supports a more positive or neutral perspective.",
    "Try asking yourself if you're overgeneralizing or catastrophizing.",
    "Let's explore where this belief came from and whether it still serves you.",
    "Would it help to imagine the worst-case scenario and how you could handle it?",
    "Let's work on developing counter-statements to your negative beliefs.",
    "Try noticing how this belief affects your feelings and behavior.",
    "Let's practice disputing this thought using objective facts.",
    "Would it help to keep a journal of when this belief shows up and how you respond?",
    "Let's explore small experiments to test whether this belief is accurate.",
    "Try reframing the belief in a way that's more compassionate toward yourself.",
    "Let's identify the impact of holding onto this negative belief.",
    "Would it help to consider a more flexible or realistic perspective?",
    "Let's practice questioning the automatic assumptions behind this belief.",
    "Try noticing alternative interpretations of situations that trigger this belief.",
    "Let's explore whether this belief is absolute or if there are exceptions.",
    "Would it help to role-play responding to situations without this negative belief?",
    "Let's work on developing affirmations that counter this belief.",
    "Try noticing if you're focusing on the negative and ignoring positive evidence.",
    "Let's explore how your belief affects your goals and daily functioning."
]


@register_event
class OfferedInterventionToAddressNegativeBeliefsEvent(SimilarityBaseEvent):
    """Event for offering intervention to address negative beliefs"""
    event_id = NEGATIVE_BELIEFS_INTERVENTION
    similar_sentences = _OFFERED_INTERVENTION_TO_ADDRESS_NEGATIVE_BELIEFS_SENTENCES
