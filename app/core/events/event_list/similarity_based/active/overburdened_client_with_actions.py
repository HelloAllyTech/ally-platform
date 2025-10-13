from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import OVERBURDEN_CLIENT

_OVERBURDENED_CLIENT_WITH_ACTIONS_SENTENCES: Sequence[str] = [
    "I want you to journal every day, meditate twice a day, and exercise five times this week.",
    "You should read these three books before our next session.",
    "Write down every single thought you have this week.",
    "I need you to track your emotions every hour.",
    "Try five new coping strategies before we meet again.",
    "You should call a friend every day to process your feelings.",
    "I want you to completely change your routine by next week.",
    "Start therapy homework every night for at least an hour.",
    "You should make a list of 100 things that make you anxious.",
    "I'd like you to practice five different breathing exercises daily.",
    "You need to restructure your whole diet by our next session.",
    "Try out all the techniques we talked about this week.",
    "Every time you feel stressed, write a page in your journal immediately.",
    "Complete this workbook before we meet again.",
    "You should attend three support groups this week.",
    "I want you to track your sleep, food, mood, and thoughts every day.",
    "Practice all the affirmations we discussed, several times a day.",
    "You should plan out your entire week in detail.",
    "Do at least ten exposure exercises before next time.",
    "I want you to set five big goals and start working on all of them this week.",
    "You should practice mindfulness for an hour every day.",
    "Try to completely eliminate negative thinking before our next session.",
    "Start a gratitude list with at least 50 items.",
    "I want you to talk with your family about everything we discussed here.",
    "Do daily homework sheets for each problem you face.",
    "You should practice every skill we covered today.",
    "Commit to three lifestyle changes this week.",
    "Make sure you never miss your daily self-care checklist.",
    "I expect you to finish this entire course before we meet again.",
    "You should implement all the strategies we discussed immediately."
]


@register_event
class OverburdenedClientWithActionsEvent(SimilarityBaseEvent):
    """Event for overburdening client with actions"""
    event_id = OVERBURDEN_CLIENT
    similar_sentences = _OVERBURDENED_CLIENT_WITH_ACTIONS_SENTENCES
