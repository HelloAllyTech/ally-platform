"""The purposes an assistant can have (copy §24): what each will and won't do, its
default sample, and the order they are offered in per industry.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.schemas.builder import Industry, PurposeId

# --- Purposes (copy §24, chunk 20a-2) ----------------------------------------

PURPOSE_MESSAGE = (
    "Based on what I learned, here's what I'd suggest. You can pick something else, "
    "and change it later."
)
CUSTOM_PROMPT = "What should your assistant help with? A sentence or two is plenty."
RECOMMENDED = "Recommended for you"


@dataclass(frozen=True)
class Purpose:
    """One of the five purposes. What it will and won't do, and what it can't do yet,
    are fixed in code; the builder only tailors "Best for" and the sample."""

    id: PurposeId
    name: str
    one_liner: str
    will: Tuple[str, ...]
    wont: Tuple[str, ...]
    limit: str
    default_sample: Tuple[Tuple[str, str], ...]


_NO_BOOKING = "Book, take orders or take payments"

PURPOSES: Dict[PurposeId, Purpose] = {
    PurposeId.ANSWER: Purpose(
        PurposeId.ANSWER,
        name="Answer questions",
        one_liner=(
            "Replies to questions about your services, prices, hours and policies, "
            "with a link to where it found each answer."
        ),
        will=(
            "Answer questions from your information",
            "Link each answer to where it came from",
            "Say plainly when it doesn't know",
        ),
        wont=(_NO_BOOKING,),
        limit="",
        default_sample=(
            ("visitor", "What are your opening hours?"),
            ("assistant", "Here's when we're open, from our website."),
        ),
    ),
    PurposeId.ENQUIRIES: Purpose(
        PurposeId.ENQUIRIES,
        name="Bring in customers",
        one_liner=(
            "Helps people find the right service, then passes their name and number "
            "to you."
        ),
        will=(
            "Recommend the service that fits",
            "Ask one question at a time",
            "Pass each person's name and number to you",
        ),
        wont=(_NO_BOOKING, "Promise discounts or slots you haven't listed"),
        limit=(
            "It can't book or take payments yet. It sends you each new enquiry by "
            "email."
        ),
        default_sample=(
            ("visitor", "Which service would suit me?"),
            ("assistant", "Happy to help. What are you looking for help with?"),
        ),
    ),
    PurposeId.TRAINING: Purpose(
        PurposeId.TRAINING,
        name="Train my team",
        one_liner="Explains your procedures to staff and quizzes them when they ask.",
        will=(
            "Explain your procedures in short steps",
            "Quiz your team when they ask",
            "Link each answer to your documents",
        ),
        wont=("Make up a procedure",),
        limit="It doesn't keep track of each person's progress yet.",
        default_sample=(
            ("visitor", "Test me on our procedures."),
            ("assistant", "Sure. First question: what's the first step?"),
        ),
    ),
    PurposeId.GUIDE: Purpose(
        PurposeId.GUIDE,
        name="Guide people step by step",
        one_liner=(
            "Walks people through a process one step at a time, like test preparation "
            "or setting up a product."
        ),
        will=(
            "Give one step at a time",
            "Check each step is done before the next",
            "Keep your steps in order, safety steps included",
        ),
        wont=("Skip or reorder steps", _NO_BOOKING),
        limit="",
        default_sample=(
            ("visitor", "How do I get ready?"),
            ("assistant", "Here's the first step. Tell me when it's done."),
        ),
    ),
    PurposeId.CUSTOM: Purpose(
        PurposeId.CUSTOM,
        name="Something else",
        one_liner="Describe what you need, and I'll set it up.",
        will=(),
        wont=(),
        limit="",
        default_sample=(),
    ),
}

#: The purposes the builder tailors (Something else is the owner's own words).
TAILORED = (PurposeId.ANSWER, PurposeId.ENQUIRIES, PurposeId.TRAINING, PurposeId.GUIDE)

_CLIENT_FIRST = [PurposeId.ENQUIRIES, PurposeId.ANSWER, PurposeId.GUIDE]
_ANSWER_FIRST = [PurposeId.ANSWER, PurposeId.ENQUIRIES, PurposeId.GUIDE]

#: Purposes best first per industry; the builder recommends one of the first two
#: (or Train my team, for an assistant for the business's own team).
PURPOSES_FOR: Dict[Industry, List[PurposeId]] = {
    Industry.MENTAL_HEALTH: [PurposeId.ANSWER, PurposeId.ENQUIRIES, PurposeId.GUIDE],
    Industry.GP_CLINIC: _ANSWER_FIRST,
    Industry.DIAGNOSTIC_LAB: [PurposeId.GUIDE, PurposeId.ANSWER, PurposeId.ENQUIRIES],
    Industry.PHARMACY: _ANSWER_FIRST,
    Industry.WELLNESS: _CLIENT_FIRST,
    Industry.D2C: _ANSWER_FIRST,
    Industry.COACHING: _CLIENT_FIRST,
    Industry.SCHOOL: _ANSWER_FIRST,
    Industry.REAL_ESTATE: _CLIENT_FIRST,
    Industry.SAAS: [PurposeId.ANSWER, PurposeId.GUIDE, PurposeId.ENQUIRIES],
    Industry.RESTAURANT: _ANSWER_FIRST,
    Industry.LEGAL_FINANCIAL: _CLIENT_FIRST,
    Industry.NON_PROFIT: _ANSWER_FIRST,
}


def purpose_order(industry: Optional[Industry], for_team: bool) -> List[PurposeId]:
    """The four tailored purposes, best first for this business."""
    order = list(PURPOSES_FOR.get(industry, _ANSWER_FIRST)) if industry else []
    order = order or list(_ANSWER_FIRST)
    if for_team:
        order.insert(0, PurposeId.TRAINING)
    return [p for i, p in enumerate(order) if p not in order[:i]] + [
        p for p in TAILORED if p not in order
    ]
