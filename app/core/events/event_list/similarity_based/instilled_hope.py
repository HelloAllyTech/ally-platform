from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import INSTILL_HOPE

_INSTILLED_HOPE_SENTENCES: Sequence[str] = [
    "What you're going through sounds incredibly difficult, and you're not alone in it.",
    "It makes sense that you feel this way given everything you've been facing.",
    "Even though it feels overwhelming, we can look together for small steps that may help.",
    "People often discover strength they didn't know they had — we can explore what that might look like for you.",
    "The pain is real, and it doesn't define your entire future.",
    "You've gotten through hard moments before — what helped you then?",
    "Right now feels heavy, and at the same time, change is possible.",
    "There may not be quick answers, but together we can work toward some relief.",
    "I hear how hopeless this feels, and I'll be here with you as we look for a way forward.",
    "Even if things don't shift overnight, small changes can build over time.",
    "You don't have to go through this alone — we can create supports around you.",
    "Part of our work can be finding the reasons you'd want to keep going, even when it feels unbearable.",
    "It's okay to not see hope right now — I can hold some of that hope until you're ready.",
    "I don't know exactly how things will change, but I believe healing is possible.",
    "You've shown courage in even talking about this — that matters.",
    "Together we can find ways to make life feel a little more manageable.",
    "It might feel like there's no way forward, but that doesn't mean there isn't one.",
    "We can take this one step at a time, at a pace that feels right for you."
]


@register_event
class CareAgentInstilledHopeEvent(SimilarityBaseEvent):
    """Event for instilling hope"""
    event_id = INSTILL_HOPE
    similar_sentences = _INSTILLED_HOPE_SENTENCES
