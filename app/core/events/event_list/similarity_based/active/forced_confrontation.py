from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import FORCE_CONFRONTATION

_FORCED_CONFRONTATION_SENTENCES: Sequence[str] = [
    "You have to tell them after this session without any excuses.",
    "You need to tell your parents everything, right away.",
    "You can't move forward until you confront your parents.",
    "You should bring this up with them, no matter how they react.",
    "You have to sit them down and explain how they hurt you.",
    "You'll never heal if you don't confront your mom/dad.",
    "You need to stop protecting your parents and tell them the truth.",
    "You should confront them at the next family gathering.",
    "You have to stand up to them, even if it causes a fight.",
    "You won't get better until you face your parents.",
    "You must tell them exactly how you feel, today.",
    "You can't keep this from your parents any longer.",
    "The only solution is to confront them directly.",
    "You should call your parents after this session and tell them.",
    "You'll always be stuck unless you force this conversation.",
    "You need to tell your father/mother they were wrong.",
    "You have to bring your parents into therapy right away.",
    "You can't avoid them forever, so you may as well confront them now.",
    "You're not doing the work if you don't challenge your parents.",
    "You should demand an apology from them immediately.",
    "You need to stop being afraid and confront your parents.",
    "The best thing for you is to go home and tell them what you told me.",
    "You'll never grow unless you confront your family head-on.",
    "You can't keep making excuses for your parents; confront them.",
    "You should force this conversation—it's the only way forward.",
    "You need to confront them no matter what it costs.",
]


@register_event
class ForcedConfrontationEvent(SimilarityBaseEvent):
    """Event for forcing confrontation"""
    event_id = FORCE_CONFRONTATION
    similar_sentences = _FORCED_CONFRONTATION_SENTENCES
