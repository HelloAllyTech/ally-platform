"""What the builder knows before it reads anything: the copy it must use word for
word, the questions each industry needs answered, and the designs that work today.

Owner-facing text here is `docs/agents-v2/ONBOARDING-COPY.md`, exactly; a test holds
every string to the deck. What the model writes is only ever the parts the deck
leaves open (a gap's item, a design's sample exchange), and code decides the rest.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Dict, List, Tuple

from app.schemas.builder import DesignId, Industry, LearnedSection

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

DESIGN_MESSAGE = (
    "Based on what I learned, here are a few ways your assistant could help. Pick "
    "one. You can change it later."
)
COMING_SOON_BODY = (
    "Booking and payments are on the way. For now, your assistant can collect "
    "details and pass them to you."
)
#: 20a-1 has no checkup yet, so building ends at Share (copy §8, added in 20a-1).
BUILT_MESSAGE = (
    "Your assistant is ready. Choose who can use it, then publish it to get your "
    "link."
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
    Industry.OTHER: [_FEES, _HOURS, _CONTACT],
}


# --- Designs (copy §7) --------------------------------------------------------


@dataclass(frozen=True)
class Design:
    """A design that works today. What it will and won't do is fixed in code, so a
    card can never promise booking, orders or payments."""

    id: DesignId
    will: Tuple[str, ...]
    wont: Tuple[str, ...]
    default_title: str
    default_best_for: str
    default_sample: Tuple[Tuple[str, str], ...]


DESIGNS: Dict[DesignId, Design] = {
    DesignId.GUIDE: Design(
        DesignId.GUIDE,
        will=(
            "Answer questions from your information",
            "Link each answer to where it came from",
            "Say plainly when it doesn't know",
        ),
        wont=("Book, take orders or take payments",),
        default_title="Client guide",
        default_best_for="Answering everyday questions about you",
        default_sample=(
            ("visitor", "What are your opening hours?"),
            ("assistant", "Here's when we're open, from our website."),
        ),
    ),
    DesignId.ENQUIRIES: Design(
        DesignId.ENQUIRIES,
        will=(
            "Ask a few questions before the chat starts",
            "Answer questions from your information",
            "Pass each person's details to you",
        ),
        wont=("Book, take orders or take payments",),
        default_title="New client enquiries",
        default_best_for="Turning first questions into enquiries you can follow up",
        default_sample=(
            ("visitor", "I'd like to know more."),
            ("assistant", "Happy to help. Could I have your name and email first?"),
        ),
    ),
    DesignId.SUPPORT: Design(
        DesignId.SUPPORT,
        will=(
            "Answer how-to and policy questions",
            "Point people to the right page",
            "Tell people how to reach your team",
        ),
        wont=("Change accounts, orders or payments",),
        default_title="Help centre",
        default_best_for="Helping existing customers find answers fast",
        default_sample=(
            ("visitor", "How do I change my details?"),
            ("assistant", "Here's how, from our help page."),
        ),
    ),
}

#: Designs to offer per industry, best first; the model picks 2–3 from these.
DESIGNS_FOR: Dict[Industry, List[DesignId]] = {
    Industry.D2C: [DesignId.SUPPORT, DesignId.GUIDE, DesignId.ENQUIRIES],
    Industry.SAAS: [DesignId.SUPPORT, DesignId.GUIDE, DesignId.ENQUIRIES],
    Industry.REAL_ESTATE: [DesignId.ENQUIRIES, DesignId.GUIDE],
}
DEFAULT_DESIGNS = [DesignId.GUIDE, DesignId.ENQUIRIES, DesignId.SUPPORT]

#: A sample exchange may not show the assistant doing what no design can do yet.
_OVERPROMISE = re.compile(
    r"\b(i'?ve booked|i have booked|booked (you|it)|you(?:'re| are) booked|"
    r"booking (is )?confirmed|reserved (a|your)|order (is |has been )?"
    r"(placed|confirmed)|placed your order|payment (is )?(received|taken|done)|"
    r"i'?ll charge|charged your)\b",
    re.IGNORECASE,
)


def overpromises(text: str) -> bool:
    return bool(_OVERPROMISE.search(text or ""))


#: The "coming soon" card, always last and never choosable.
COMING_SOON_ID = "coming_soon"
