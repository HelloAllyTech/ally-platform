from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import POSITIVE_REFRAMING

_OFFERED_POSITIVE_REFRAMING_SENTENCES: Sequence[str] = [
    "Even though this was difficult, it shows how resilient you are.",
    "This challenge also highlights your capacity to cope.",
    "While it's painful, it also reflects how much you care.",
    "Your reaction makes sense, and it shows your self-awareness.",
    "Though it didn't go as planned, you learned something valuable from it.",
    "Even in this setback, there's evidence of your strength.",
    "This disappointment shows how invested you were — that's meaningful.",
    "Even though it feels overwhelming, it also highlights your determination.",
    "Your fear is understandable, and it also shows your attentiveness to risks.",
    "This struggle is a sign of your commitment to growth.",
    "While this was challenging, it also points to your courage in facing it.",
    "Your frustration shows how much you value doing things well.",
    "Even in difficult moments, you're finding ways to cope.",
    "This experience is tough, but it also demonstrates your persistence.",
    "Your reaction is normal, and it also highlights your emotional intelligence.",
    "Even though this feels like a failure, it shows your willingness to try.",
    "This situation is hard, but it also reveals your resourcefulness.",
    "While it's uncomfortable, it also signals that you care deeply about the outcome.",
    "Even in this pain, there's evidence of your growth over time.",
    "This setback shows your humanity, and also your capacity to learn.",
    "Even though it didn't go smoothly, you handled it better than you realize.",
    "Your struggle highlights both the challenge and your ability to navigate it.",
    "While it's disappointing, it also underscores your dedication.",
    "This moment is difficult, yet it shows your resilience under pressure.",
    "Even when things feel stuck, it reflects your commitment to improvement.",
    "Your emotions are valid, and they also reveal your self-awareness.",
    "While fear is uncomfortable, it shows your capacity to anticipate and protect yourself.",
    "This difficult experience is part of a larger story of growth and learning.",
    "Even in uncertainty, you're demonstrating patience and persistence.",
    "While this is a painful moment, it also shows your capacity for reflection.",
]


@register_event
class CareAgentOfferedPositiveReframingEvent(SimilarityBaseEvent):
    """Event for offering positive reframing"""
    event_id = POSITIVE_REFRAMING
    similar_sentences = _OFFERED_POSITIVE_REFRAMING_SENTENCES
