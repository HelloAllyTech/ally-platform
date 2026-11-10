"""What the builder knows before it reads anything: the copy it must use word for
word, the questions each industry needs answered, and the purposes it can have.

Owner-facing text here is `docs/agents-v2/ONBOARDING-COPY.md`, exactly; a test holds
every string to the deck. What the model writes is only ever the parts the deck
leaves open (a gap's item, a purpose's sample exchange), and code decides the rest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Optional, Tuple

from app.schemas.builder import Industry, LearnedSection, PurposeId

# --- Copy §2, §3, §6, §7, §8 --------------------------------------------------

OPENING_MESSAGE = (
    "Hi, I'm here to set up your assistant with you. Paste your website and I'll "
    "start reading. You can watch what I find on the right."
)
OPENING_CHIPS = ["Use my website", "Upload documents", "Describe it instead"]
DESCRIBE_PROMPT = (
    "Tell me what your business does, who you help, and what people usually ask "
    "you. A few sentences is plenty."
)

READING_DONE = (
    "I've read {n} pages. Here's what I learned, and each detail links to the page "
    "it came from. Take a quick look: if anything's wrong, tell me or edit it "
    "directly."
)
LOOKS_RIGHT = "Looks right"

#: Live finding lines (copy §3), by learned section.
FINDINGS: Dict[LearnedSection, str] = {
    LearnedSection.SERVICES: "Found your services and prices",
    LearnedSection.HOURS: "Found your opening hours",
    LearnedSection.TEAM: "Found {n} team members",
    LearnedSection.FAQS: "Found {n} questions people often ask",
    LearnedSection.LOCATION: "Found your address and contact details",
}

GAP_MESSAGE = "One thing I couldn't find: {item}. {why}"
GAP_CHIPS = ["Add it now", "Skip for now", "We don't offer this"]
PROGRESS_NOTE = "{n} quick questions left"

AUDIENCE_QUESTION = "Who will mostly talk to your assistant?"
AUDIENCE_CHIPS = ["Clients or customers", "My team", "Both"]
LANGUAGE_QUESTION = "Which languages should it reply in?"
LANGUAGE_CHIPS = ["English", "Hindi", "Marathi", "Tamil", "Other"]
LANGUAGE_NOTE = (
    "It replies in the language each person writes in, from the ones you choose."
)
DECLINE_QUESTION = "When it doesn't know something, where should it point people?"
DECLINE_CHIPS = [
    "Our phone number",
    "Our email",
    "Our front desk",
    "Somewhere else",
]

BUILT_MESSAGE = (
    "Your assistant is ready. Choose who can use it, and I'll create your link."
)

#: The language chips as BCP-47 tags.
LANGUAGE_TAGS: Dict[str, str] = {
    "english": "en",
    "hindi": "hi",
    "marathi": "mr",
    "tamil": "ta",
    "telugu": "te",
    "kannada": "kn",
    "bengali": "bn",
    "gujarati": "gu",
    "malayalam": "ml",
    "punjabi": "pa",
    "urdu": "ur",
}

# --- The questions every onboarding asks -------------------------------------

#: Asked after the gaps, in this order (copy §6).
FIXED_QUESTIONS: List[Tuple[str, str, List[str]]] = [
    ("audience", AUDIENCE_QUESTION, AUDIENCE_CHIPS),
    ("languages", LANGUAGE_QUESTION, LANGUAGE_CHIPS),
    ("decline", DECLINE_QUESTION, DECLINE_CHIPS),
]

#: At most this many gaps are asked, so the whole set stays at six questions.
MAX_GAPS = 3


@dataclass(frozen=True)
class GapCheck:
    """One thing an industry's assistant needs to know. `item` and `why` complete
    copy §6's pattern: "One thing I couldn't find: {item}. {why}"."""

    key: str
    item: str
    why: str
    sections: Tuple[LearnedSection, ...]


_HOURS = GapCheck(
    "hours",
    "your opening hours",
    "People often ask when they can visit or call.",
    (LearnedSection.HOURS,),
)
_CONTACT = GapCheck(
    "contact",
    "how to reach you",
    "People need a number or email when the assistant can't help.",
    (LearnedSection.LOCATION,),
)
_FEES = GapCheck(
    "fees",
    "your fees",
    "Price is one of the first things people ask.",
    (LearnedSection.SERVICES,),
)
_CANCELLATION = GapCheck(
    "cancellation",
    "your cancellation policy",
    "People often ask before they book.",
    (LearnedSection.POLICIES,),
)

#: The checklist per industry, most important first.
GAP_CHECKLISTS: Dict[Industry, List[GapCheck]] = {
    Industry.MENTAL_HEALTH: [
        _FEES,
        _CANCELLATION,
        GapCheck(
            "crisis_contacts",
            "the crisis contacts you want shared",
            "Your assistant shares them straight away if someone may be at risk.",
            (LearnedSection.POLICIES, LearnedSection.LOCATION),
        ),
        GapCheck(
            "session_modes",
            "whether sessions are online, in person or both",
            "New clients usually ask this first.",
            (LearnedSection.SERVICES,),
        ),
        _HOURS,
        _CONTACT,
    ],
    Industry.GP_CLINIC: [
        _HOURS,
        GapCheck(
            "emergency",
            "what to do in an emergency or after hours",
            "Your assistant points urgent symptoms there.",
            (LearnedSection.POLICIES, LearnedSection.LOCATION),
        ),
        _FEES,
        GapCheck(
            "insurance",
            "which insurance you accept",
            "Patients often ask before they visit.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES),
        ),
        _CONTACT,
    ],
    Industry.DIAGNOSTIC_LAB: [
        GapCheck(
            "report_times",
            "how long reports take",
            "It's the most common question after a test.",
            (LearnedSection.SERVICES, LearnedSection.POLICIES, LearnedSection.FAQS),
        ),
        GapCheck(
            "home_collection",
            "whether you collect samples at home",
            "People often ask before they book a test.",
            (LearnedSection.SERVICES,),
        ),
        _FEES,
        _HOURS,
        _CONTACT,
    ],
    Industry.PHARMACY: [
        _HOURS,
        GapCheck(
            "delivery",
            "whether you deliver, and where",
            "People often ask before they order.",
            (LearnedSection.SERVICES, LearnedSection.POLICIES),
        ),
        GapCheck(
            "prescriptions",
            "how people should send a prescription",
            "Your assistant can't take orders yet, so it must say where to send it.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES),
        ),
        _CONTACT,
    ],
    Industry.WELLNESS: [_FEES, _HOURS, _CANCELLATION, _CONTACT],
    Industry.D2C: [
        GapCheck(
            "shipping",
            "your shipping times and charges",
            "It's one of the first things shoppers ask.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES),
        ),
        GapCheck(
            "returns",
            "your returns policy",
            "People often ask before they buy.",
            (LearnedSection.POLICIES,),
        ),
        _CONTACT,
    ],
    Industry.COACHING: [
        _FEES,
        GapCheck(
            "batches",
            "your batch timings",
            "Parents and students ask this first.",
            (LearnedSection.HOURS, LearnedSection.SERVICES),
        ),
        GapCheck(
            "admissions",
            "how admissions work",
            "Most enquiries are about joining.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES, LearnedSection.FAQS),
        ),
        _CONTACT,
    ],
    Industry.SCHOOL: [
        GapCheck(
            "admissions",
            "how admissions work",
            "Most enquiries are about joining.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES, LearnedSection.FAQS),
        ),
        _FEES,
        _HOURS,
        _CONTACT,
    ],
    Industry.REAL_ESTATE: [
        GapCheck(
            "site_visits",
            "how people can arrange a site visit",
            "Your assistant can collect details and pass them on.",
            (LearnedSection.SERVICES, LearnedSection.POLICIES),
        ),
        GapCheck(
            "prices",
            "your price ranges",
            "Buyers usually ask before anything else.",
            (LearnedSection.SERVICES,),
        ),
        _CONTACT,
    ],
    Industry.SAAS: [
        GapCheck(
            "pricing",
            "your plans and pricing",
            "It's one of the first things people ask.",
            (LearnedSection.SERVICES,),
        ),
        GapCheck(
            "support_hours",
            "when your support team is available",
            "People want to know when a person will reply.",
            (LearnedSection.HOURS, LearnedSection.POLICIES),
        ),
        _CONTACT,
    ],
    Industry.RESTAURANT: [
        _HOURS,
        GapCheck(
            "reservations",
            "how people can reserve a table",
            "Your assistant can't book yet, so it needs to say how.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES),
        ),
        GapCheck(
            "delivery",
            "whether you deliver, and where",
            "People often ask before they order.",
            (LearnedSection.SERVICES, LearnedSection.POLICIES),
        ),
        _CONTACT,
    ],
    Industry.LEGAL_FINANCIAL: [
        _FEES,
        GapCheck(
            "consultation",
            "how a first consultation works",
            "New clients usually ask this first.",
            (LearnedSection.SERVICES, LearnedSection.POLICIES),
        ),
        _HOURS,
        _CONTACT,
    ],
    Industry.NON_PROFIT: [
        GapCheck(
            "programmes",
            "what your programmes are and who they're for",
            "People want to know how you can help them.",
            (LearnedSection.SERVICES, LearnedSection.ABOUT),
        ),
        GapCheck(
            "donate",
            "how people can donate",
            "Supporters often ask how to give.",
            (LearnedSection.POLICIES, LearnedSection.SERVICES, LearnedSection.FAQS),
        ),
        GapCheck(
            "volunteer",
            "how people can volunteer",
            "Many people write in wanting to help.",
            (LearnedSection.SERVICES, LearnedSection.FAQS),
        ),
        _CONTACT,
    ],
    Industry.OTHER: [_FEES, _HOURS, _CONTACT],
}


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


#: A sample exchange may not show the assistant doing what no purpose can do yet.
_OVERPROMISE = re.compile(
    r"\b(i'?ve booked|i have booked|booked (you|it)|you(?:'re| are) booked|"
    r"booking (is )?confirmed|reserved (a|your)|order (is |has been )?"
    r"(placed|confirmed)|placed your order|payment (is )?(received|taken|done)|"
    r"i'?ll charge|charged your)\b",
    re.IGNORECASE,
)


def overpromises(text: str) -> bool:
    return bool(_OVERPROMISE.search(text or ""))


#: The assistant itself booking, ordering or taking payment ("I can book a session for
#: you"): a sentence like this is dropped from what the builder drafts.
_DOES_BOOKING = re.compile(
    r"\b(?:i|you|it|we|the assistant)\s+(?:can|will|could)\s+(?:also\s+)?"
    r"(?:book|schedule|reserve|take|place|process|accept)\s+(?:an?\s+|the\s+|your\s+)?"
    r"(?:appointments?|sessions?|consultations?|slots?|tables?|orders?|payments?|"
    r"bookings?)\b|\b(?:book|schedule|reserve)\s+(?:it|one|a \w+)\s+for you\b",
    re.IGNORECASE,
)
#: "Booking" as something it helps with, in a list: it explains how to book instead.
_BOOKING_TOPIC = re.compile(r"\bbookings?\b(?!\s+(?:is|are)\s+not)", re.IGNORECASE)


def honest_about_booking(text: str) -> str:
    """`text` without the assistant claiming to book, order or take payment: a
    sentence saying it does is dropped, and "booking" as a topic it covers becomes
    "how to book"."""
    sentences = re.split(r"(?<=[.!?])\s+|\n", text or "")
    kept: List[str] = []
    for sentence in sentences:
        if not sentence.strip() or _DOES_BOOKING.search(sentence):
            continue
        if re.search(r"\b(?:help|helps|cover|covers|answer|answers)\b", sentence, re.I):
            sentence = _BOOKING_TOPIC.sub("how to book", sentence)
        kept.append(sentence)
    joiner = "\n" if "\n" in (text or "") else " "
    return joiner.join(kept).strip()
