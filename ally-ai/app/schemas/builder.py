"""Request/response shapes for `/builder/*`, the onboarding builder (chunk 20a).

ally-be owns the draft and every write. These models describe what it sends the
builder and what the builder proposes back; ally-be validates and applies the
proposals. `BotDraft` mirrors `ally-be/src/bot-draft/type/bot-draft.type.ts`, held in
step by the shared fixture `ally-be/src/bot-draft/test/bot-draft.contract.json`.
"""

from enum import Enum
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, ConfigDict, Field

#: The onboarding steps (ally-be's BotDraftStep). 20a-2 adds `checkup` and `try_it`.
Step = Literal[
    "start",
    "reading",
    "learned",
    "safety",
    "gaps",
    "design",
    "building",
    "checkup",
    "try_it",
    "share",
    "published",
]


class Industry(str, Enum):
    """ally-be's Industry. The builder classifies; ally-be picks the pack from it."""

    MENTAL_HEALTH = "mental_health"
    GP_CLINIC = "gp_clinic"
    DIAGNOSTIC_LAB = "diagnostic_lab"
    PHARMACY = "pharmacy"
    WELLNESS = "wellness"
    D2C = "d2c"
    COACHING = "coaching"
    SCHOOL = "school"
    REAL_ESTATE = "real_estate"
    SAAS = "saas"
    RESTAURANT = "restaurant"
    LEGAL_FINANCIAL = "legal_financial"
    NON_PROFIT = "non_profit"
    OTHER = "other"


class CareTopic(str, Enum):
    """What the business deals with that calls for care, whatever kind it is. ally-be
    picks the safety pack from these and the industry, in code: a mental health
    non-profit gets Mental health safety."""

    MENTAL_HEALTH = "mental_health"
    MEDICAL = "medical"
    MEDICINES = "medicines"
    YOUNG_PEOPLE = "young_people"
    LEGAL_FINANCIAL = "legal_financial"


class LearnedSection(str, Enum):
    """A "What we learned" section (copy §4)."""

    ABOUT = "about"
    SERVICES = "services"
    HOURS = "hours"
    TEAM = "team"
    LOCATION = "location"
    POLICIES = "policies"
    FAQS = "faqs"
    BRAND = "brand"


class DesignId(str, Enum):
    """The designs that work today. Booking and orders are only ever "coming soon"."""

    GUIDE = "guide"
    ENQUIRIES = "enquiries"
    SUPPORT = "support"


class PrechatFieldType(str, Enum):
    """ally-be's PrechatFieldType (12b)."""

    TEXT = "text"
    EMAIL = "email"
    PHONE = "phone"
    CHOICE = "choice"
    CONSENT = "consent"


class _Lenient(BaseModel):
    # ally-be may add fields before this service knows them; never refuse a draft
    # for that.
    model_config = ConfigDict(extra="allow", populate_by_name=True)


class Branding(_Lenient):
    logoUrl: Optional[str] = None
    accentColour: str = "#264D8E"
    title: str = ""
    subtitle: str = ""
    assistantName: str = ""
    avatarUrl: Optional[str] = None
    disclaimer: str = ""
    footerLink: Optional[Dict[str, str]] = None


class PrechatField(_Lenient):
    id: str
    label: str
    type: PrechatFieldType
    required: bool = False
    options: Optional[List[str]] = None
    consentText: Optional[str] = None


class Access(_Lenient):
    mode: Literal["public", "organisation", "invite"] = "invite"
    emails: List[str] = Field(default_factory=list)
    organisationIds: List[str] = Field(default_factory=list)


class BotDraft(_Lenient):
    """The assistant being built. camelCase, as ally-be stores it."""

    name: str = ""
    assistantName: str = ""
    introduction: str = ""
    instructions: str = ""
    tone: Literal["warm", "professional", "friendly", "formal"] = "warm"
    languages: List[str] = Field(default_factory=lambda: ["en"])
    topics: List[str] = Field(default_factory=list)
    knowledgeDocumentIds: List[str] = Field(default_factory=list)
    ownerNotes: str = ""
    suggestedQuestions: List[str] = Field(default_factory=list)
    prechat: List[PrechatField] = Field(default_factory=list)
    declineText: str = ""
    safetyPackId: str = "standard"
    extraNever: List[str] = Field(default_factory=list)
    branding: Branding = Field(default_factory=Branding)
    access: Access = Field(default_factory=Access)
    design: Optional[DesignId] = None


class LearnedFact(_Lenient):
    id: str
    section: LearnedSection
    text: str
    sourceUrl: str
    sourceTitle: Optional[str] = None
    byOwner: bool = False


class Learned(_Lenient):
    facts: List[LearnedFact] = Field(default_factory=list)
    dropped: int = 0


class PageSummary(BaseModel):
    """One crawled page, as the builder sees it: never the whole page."""

    url: str = Field(..., max_length=2000)
    title: str = Field("", max_length=300)
    headings: List[str] = Field(default_factory=list, max_length=30)
    snippet: str = Field("", max_length=600)


class PageText(BaseModel):
    """One crawled page for fact extraction: its readable text, capped by ally-be."""

    url: str = Field(..., max_length=2000)
    title: str = Field("", max_length=300)
    text: str = Field("", max_length=12000)


class SafetyPackInfo(BaseModel):
    """The draft's pack, as ally-be describes it. The builder never chooses one."""

    id: str = "standard"
    name: str = "Facts only"
    always: List[str] = Field(default_factory=list)
    never: List[str] = Field(default_factory=list)
    at_risk: List[str] = Field(default_factory=list)


class Gap(BaseModel):
    """Something the owner should be asked about, from the industry checklist."""

    key: str = Field(..., max_length=60)
    item: str = Field(..., max_length=200)
    why: str = Field("", max_length=200)


class DesignCard(BaseModel):
    """One design card (copy §7)."""

    id: str
    title: str
    best_for: str
    will: List[str]
    wont: List[str]
    sample: List[Dict[str, str]]
    coming_soon: bool = False


class HistoryTurn(BaseModel):
    role: Literal["builder", "owner", "note"]
    text: str = Field("", max_length=4000)


class BuilderStepRequest(BaseModel):
    """One conversation step. ally-be sends the whole state; nothing is kept here."""

    draft_id: Optional[str] = Field(None, max_length=200)
    step: Step
    message: str = Field("", max_length=4000)
    chip: str = Field("", max_length=200)
    draft: BotDraft = Field(default_factory=BotDraft)
    learned: Learned = Field(default_factory=Learned)
    # The owner's answers, by question key (a gap's key, `audience`, `languages`,
    # `decline`). `pending` names the question last asked, if any.
    answers: Dict[str, str] = Field(default_factory=dict)
    pending: str = Field("", max_length=60)
    industry: Optional[Industry] = None
    gaps: Optional[List[Gap]] = Field(
        None, description="Gaps found earlier; None until the gaps step has run"
    )
    designs: Optional[List[DesignCard]] = None
    pages: List[PageSummary] = Field(default_factory=list, max_length=50)
    safety_pack: SafetyPackInfo = Field(default_factory=SafetyPackInfo)
    description: str = Field(
        "", max_length=4000, description="What the owner wrote instead of a website"
    )
    history: List[HistoryTurn] = Field(default_factory=list, max_length=40)
    prompts: Optional[Dict[str, Any]] = None


class PatchOp(BaseModel):
    op: Literal["add", "replace", "remove"]
    path: str
    value: Any = None


class BuilderStepResponse(BaseModel):
    """What the builder proposes. ally-be applies what it allows, in this order:
    `learned_patches`, `patches`, then `next_step` (which it checks itself)."""

    message: str
    chips: List[str] = Field(default_factory=list)
    patches: List[PatchOp] = Field(default_factory=list)
    learned_patches: List[PatchOp] = Field(default_factory=list)
    next_step: Step
    questions_left: int = 0
    # The question this message asks, for ally-be to record the next answer under.
    asking: str = ""
    # The owner's answer to `pending`, as ally-be should store it ("" = none given).
    answer: str = ""
    industry: Optional[Industry] = None
    care_topics: List[CareTopic] = Field(default_factory=list)
    gaps: Optional[List[Gap]] = None
    designs: Optional[List[DesignCard]] = None
    # Patches the builder proposed and this service dropped (outside its paths).
    dropped_patches: int = 0


class ExtractRequest(BaseModel):
    """A batch of crawled pages, read for "What we learned"."""

    draft_id: Optional[str] = Field(None, max_length=200)
    pages: List[PageText] = Field(..., min_length=1, max_length=12)
    # Facts already found, so the same detail isn't returned twice.
    known: List[str] = Field(default_factory=list, max_length=200)
    prompts: Optional[Dict[str, Any]] = None


class ExtractedFact(BaseModel):
    section: LearnedSection
    text: str
    source_url: str
    source_title: str = ""


class ExtractResponse(BaseModel):
    facts: List[ExtractedFact] = Field(default_factory=list)
    # Facts the model gave without a source we sent it: dropped, never stored.
    dropped: int = 0
    # Live finding lines for the canvas ("Found your opening hours"), copy §3.
    findings: List[str] = Field(default_factory=list)
    # The business's name as the pages write it ("" if they don't), for a draft the
    # owner hasn't named yet.
    business_name: str = ""
