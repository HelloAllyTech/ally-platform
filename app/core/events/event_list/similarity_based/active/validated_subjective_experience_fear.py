from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import VALIDATE_FEAR

_VALIDATED_FEAR_SENTENCES: Sequence[str] = [
    "It makes sense that you feel afraid.",
    "Given what you've been through, of course this feels scary.",
    "I can see why that situation would feel threatening to you.",
    "Your fear is valid — it's telling us something important.",
    "Of course you're scared; this is a lot to face.",
    "It's completely understandable that you'd feel fear in that moment.",
    "Your reaction is normal for what you've experienced.",
    "That fear is real for you, and it matters.",
    "Anyone in your shoes might feel the same way.",
    "It makes sense that your body is responding with fear.",
    "You're not overreacting — this is frightening for you.",
    "That fear comes from somewhere, and it's important we listen to it.",
    "It's okay that this feels terrifying right now.",
    "I hear how afraid you are, and I take that seriously.",
    "Your fear is understandable, given the circumstances.",
    "It makes sense that you'd be on edge.",
    "This is scary for you, and that's valid.",
    "Your fear is part of how your mind is protecting you.",
    "It's natural that this feels unsafe for you.",
    "I can understand why you'd be frightened.",
    "That fear is a very real part of your experience.",
    "You have good reasons to feel afraid.",
    "Of course you're feeling fear — this situation triggers it for you.",
    "It makes sense that your fear is so strong right now.",
    "I can see how this would set off alarm bells inside you.",
    "Your fear is completely valid in the context of what's happening.",
    "It's natural to feel fear in situations like this.",
    "I hear that you're scared, and it's important we honor that.",
    "Your fear is a real experience, not something to dismiss.",
    "It makes sense you'd be afraid of that happening again."
]


@register_event
class CareAgentValidatedSubjectiveExperienceFearEvent(SimilarityBaseEvent):
    """Event for validating subjective experience fear"""
    event_id = VALIDATE_FEAR
    similar_sentences = _VALIDATED_FEAR_SENTENCES
