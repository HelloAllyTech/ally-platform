from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import IGNORE_CONTEXT

_IGNORED_CONTEXT_SENTENCES: Sequence[str] = [
    "Don't think about your family, focus on yourself.",
    "Let's not focus on your work situation; this is really about your anxiety.",
    "Everyone feels that way sometimes, so it's not a big deal.",
    "Don't worry about your family background; what matters is how you cope now.",
    "You're overthinking it—it's not about your culture.",
    "Other people have it worse.",
    "Let's not bring in politics or society; this is about your thoughts.",
    "It doesn't matter what happened in your past, you just need to change your mindset.",
    "You shouldn't let your upbringing influence you so much.",
    "Your feelings aren't really connected to your circumstances.",
    "You're making too much of your trauma history.",
    "It's just depression—it doesn't matter why you feel this way.",
    "Your stress at work isn't the issue, it's how you're handling it.",
    "Your financial situation doesn't really explain your sadness.",
    "Don't focus on the racism/sexism you've experienced, focus on your attitude.",
    "Your partner's behavior isn't the problem, it's how you react to it.",
    "You're too focused on the past, let's just fix your present thinking.",
    "Your emotions are the issue, not what's happening around you.",
    "Context doesn't matter, what matters is building coping skills.",
    "Lots of people go through what you did, so it's not significant.",
    "Your background isn't relevant here.",
    "Let's not get into your environment; this is about your choices.",
    "You're paying too much attention to outside factors.",
    "Family dynamics aren't important—you just need to focus on yourself.",
    "Your social identity doesn't affect your mental health.",
    "You shouldn't let external circumstances define your feelings.",
    "Trauma doesn't matter; what matters is how you think about it now.",
    "Don't dwell on discrimination—you need to take responsibility for your emotions.",
    "Your struggles are internal, not connected to anything outside you.",
    "It's just a mental health issue, not about your life situation."
]


@register_event
class IgnoredContextEvent(SimilarityBaseEvent):
    """Event for ignoring context"""
    event_id = IGNORE_CONTEXT
    similar_sentences = _IGNORED_CONTEXT_SENTENCES
