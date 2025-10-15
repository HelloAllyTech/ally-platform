from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import DEFICIT_FOCUS

_FOLLOWED_DEFICIT_FOCUSED_APPROACH_SENTENCES: Sequence[str] = [
    "You don't have good coping skills.",
    "You lack resilience.",
    "You're too dependent on others.",
    "You don't manage stress well.",
    "You're not strong enough to handle this.",
    "You avoid responsibility.",
    "You're too emotional.",
    "You can't control your impulses.",
    "You're not motivated enough to change.",
    "You lack discipline.",
    "You're always sabotaging yourself.",
    "You don't think rationally.",
    "You're too negative.",
    "You struggle with communication.",
    "You're not good at relationships.",
    "You can't handle conflict.",
    "You don't follow through on things.",
    "You're too sensitive.",
    "You lack self-control.",
    "You don't know how to manage your anger.",
    "You're not consistent.",
    "You're too insecure.",
    "You don't trust yourself.",
    "You lack confidence.",
    "You're too impulsive.",
    "You don't make good decisions.",
    "You're not assertive enough.",
    "You avoid your problems instead of facing them.",
    "You can't stay focused.",
    "You're not committed to therapy.",
    "You're too resistant to change.",
    "You don't know how to set boundaries.",
    "You lack social skills.",
    "You're not emotionally stable.",
    "You keep failing to meet your goals.",
    "You're too disorganized.",
    "You don't have enough willpower.",
    "You're not trying hard enough.",
    "You're always making excuses."
]


@register_event
class CareAgentFollowedDeficitFocusedApproachEvent(SimilarityBaseEvent):
    """Event for following deficit-focused approach"""
    event_id = DEFICIT_FOCUS
    similar_sentences = _FOLLOWED_DEFICIT_FOCUSED_APPROACH_SENTENCES
