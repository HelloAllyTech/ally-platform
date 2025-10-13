from typing import Sequence

from app.core.events.event_list.similarity_based.base import SimilarityBaseEvent
from app.core.events.registry import register_event
from app.core.events.event_list.similarity_based.event_ids import EXPLORE_BELIEFS

_EXPLORED_INNER_BELIEFS_ABOUT_SELF_SENTENCES: Sequence[str] = [
    "What does this make you believe about yourself?",
    "What are the most fundamental beliefs you have about yourself?",
    "How do you see yourself at your core?",
    "What messages about yourself have felt true for most of your life?",
    "How do you define your sense of self?",
    "What beliefs about yourself guide how you respond to challenges?",
    "What do you believe about your worth or value as a person?",
    "How do you see yourself when no one else is watching?",
    "What underlying beliefs influence how you act or feel?",
    "Which beliefs about yourself feel automatic or unquestioned?",
    "How do you typically interpret events in light of your self-beliefs?",
    "What do you believe about your ability to succeed or fail?",
    "How do you see your strengths and limitations at a core level?",
    "What core beliefs affect your relationships with others?",
    "How do these beliefs shape your expectations of yourself?",
    "What do you believe about being deserving of love or respect?",
    "How have these beliefs about yourself developed over time?",
    "What are the thoughts you return to about yourself most often?",
    "How do your core beliefs influence your sense of identity?",
    "What assumptions do you hold about your capabilities?",
    "How do you feel about yourself when things go wrong?",
    "What deep-seated beliefs guide your self-judgment?",
    "How do you typically view your role or place in the world?",
    "What core beliefs might be holding you back?",
    "How do you define yourself in difficult situations?",
    "What do you believe about yourself when you're alone with your thoughts?",
    "What do you consider your essential qualities as a person?",
    "How do these beliefs impact your emotions and decisions?",
    "What truths about yourself feel unchangeable?",
    "How do your core self-beliefs influence the way you interact with others?",
]


@register_event
class ExploredInnerBeliefsAboutSelfEvent(SimilarityBaseEvent):
    """Event for exploring inner beliefs about self"""
    event_id = EXPLORE_BELIEFS
    similar_sentences = _EXPLORED_INNER_BELIEFS_ABOUT_SELF_SENTENCES
