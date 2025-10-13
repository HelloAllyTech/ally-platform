from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import JUDGE_CLIENT

_JUDGED_CLIENT_AGENT_SENTENCES: Sequence[str] = [
    "Why would you do something like that?",
    "That was a bad decision.",
    "You should have known better.",
    "That's not a normal reaction.",
    "Most people wouldn't have done that.",
    "You're being unreasonable.",
    "That's a selfish way to think.",
    "You shouldn't be feeling this way.",
    "That doesn't make sense — you're overcomplicating things.",
    "You're too emotional about this.",
    "That's just an excuse.",
    "You're being dramatic.",
    "No wonder people react to you that way.",
    "That's irresponsible.",
    "You're making poor choices.",
    "That's not how an adult should behave.",
    "You're being immature.",
    "That's a weak way to look at it.",
    "You really messed this up, didn't you?",
    "You're overreacting again."
]


@register_event
class CareAgentJudgedClientAgentEvent(SimilarityBaseEvent):
    """Event for judging client agent"""
    event_id = JUDGE_CLIENT
    similar_sentences = _JUDGED_CLIENT_AGENT_SENTENCES
