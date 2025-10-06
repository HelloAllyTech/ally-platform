from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import PATHOLOGIZE_SYMPTOMS

_PATHOLOGIZED_CLIENTS_SYMPTOMS_SENTENCES: Sequence[str] = [
    "Sounds like you are depressed.",
    "You're being irrational.",
    "That sounds like a symptom of a disorder.",
    "You're overreacting.",
    "You're just too sensitive.",
    "This is classic depression.",
    "You're exhibiting borderline behavior.",
    "Your thinking is distorted.",
    "This is abnormal.",
    "You sound paranoid.",
    "That's a sign of emotional instability.",
    "You're catastrophizing again.",
    "You're overly dependent.",
    "That's not healthy.",
    "You're in denial.",
    "This is maladaptive.",
    "You're being obsessive.",
    "You're showing narcissistic tendencies.",
    "That's dysfunctional.",
    "You're acting out.",
    "You're fixated on this issue.",
    "You have poor coping skills.",
    "You're emotionally immature.",
    "You're being resistant.",
    "That's a trauma response.",
    "You're regressing.",
    "You're avoiding reality.",
    "You're codependent.",
    "You're just anxious.",
    "You're having an episode.",
    "You're not thinking logically.",
    "This is pathological.",
    "You're being manipulative.",
    "You're overly negative.",
    "You're unstable right now.",
    "You're not resilient enough.",
    "That's a personality issue.",
    "You're being irrationally fearful.",
    "You're stuck in victim mentality.",
    "You're too emotional.",
    "You're not functioning normally.",
    "You're experiencing cognitive distortions.",
    "You're unconsciously sabotaging yourself."
]


@register_event
class PathologizedClientsSymptomsEvent(SimilarityBaseEvent):
    """Event for pathologizing client's symptoms"""
    event_id = PATHOLOGIZE_SYMPTOMS
    similar_sentences = _PATHOLOGIZED_CLIENTS_SYMPTOMS_SENTENCES
