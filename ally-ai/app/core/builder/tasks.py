"""The builder's sub-tasks: one structured model call each, then the checks that make
what comes back safe to propose.

What the model may decide is kept small on purpose. It never picks the safety pack
(ally-be maps the industry), never names a draft path (code builds the patches), and
never says what a purpose will do (that is fixed in the catalogue).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Tuple, Type, TypeVar

from pydantic import BaseModel

from app.core.builder import catalogue
from app.core.builder.prompt import (
    format_answers,
    format_draft,
    format_history,
    format_learned,
    format_list,
    format_pack,
    format_page_texts,
    format_pages,
)
from app.core.builder.schemas import (
    ClassifyOut,
    ConverseOut,
    DraftOut,
    ExtractOut,
    GapsOut,
    PurposesOut,
)
from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format
from app.schemas.builder import (
    BuilderStepRequest,
    CareTopic,
    DesignCard,
    ExtractedFact,
    ExtractRequest,
    ExtractResponse,
    Gap,
    Industry,
    LearnedSection,
    PurposeId,
)
from app.utils.logger import get_logger

logger = get_logger(__name__)

T = TypeVar("T", bound=BaseModel)

#: Labels for the owner's answers, as the prompts show them.
FIXED_LABELS = {
    "audience": "Who will mostly talk to the assistant",
    "languages": "Languages",
    "decline": "Where to point people when it doesn't know",
}


#: Output cap for a sub-task. A reasoning model's hidden reasoning counts against it,
#: so 2,048 (the dispatcher's default) cut the draft and the conversation step short.
STEP_MAX_TOKENS = 6000


async def call(
    path: str,
    schema: Type[T],
    task: LLMTask,
    *,
    prompts: Optional[Dict[str, Any]],
    timeout: Optional[float],
    reasoning: bool = False,
    max_tokens: Optional[int] = STEP_MAX_TOKENS,
    **variables: Any,
) -> T:
    """Render `builder/<path>` and run it. A missing template is an error, never an
    unguided call."""
    prompt_path = f"builder/{path}"
    prompt = load_and_format(prompt_path, prompts=prompts, **variables)
    if not prompt:
        logger.error("Builder prompt %s resolved empty", prompt_path)
        raise LLMInvocationFailedException(
            f"The builder prompt {prompt_path} is missing or empty."
        )
    provider, model, temperature = get_backend_llm_overrides(prompt_path, prompts)
    parsed, _meta = await generate_structured(
        schema=schema,
        prompt=prompt,
        task=task.value,
        provider=provider,
        model=model,
        temperature=temperature if temperature is not None else 0.0,
        reasoning_effort=settings.BUILDER.REASONING_EFFORT if reasoning else None,
        timeout=timeout,
        max_tokens=max_tokens,
    )
    return parsed


def answer_labels(gaps: Optional[Sequence[Gap]]) -> Dict[str, str]:
    return {**FIXED_LABELS, **{gap.key: gap.item for gap in gaps or []}}


# --- extract -----------------------------------------------------------------

_FACT_MAX_CHARS = 500
SECTIONS = {section.value for section in LearnedSection}


async def extract(request: ExtractRequest) -> ExtractResponse:
    """Facts from a batch of pages. A fact must cite a page in this batch: one that
    doesn't is dropped and counted, never stored."""
    out = await call(
        "extract",
        ExtractOut,
        LLMTask.ONBOARDING_EXTRACT_FACTS,
        prompts=request.prompts,
        timeout=settings.BUILDER.EXTRACT_TIMEOUT_SECONDS,
        reasoning=True,
        # Uncapped: the facts grow with the pages read, and a cap that cuts them off
        # fails the whole batch (finish_reason=length) rather than shortening it.
        max_tokens=None,
        known=format_list(request.known, "(nothing yet)"),
        pages=format_page_texts(request.pages),
    )
    known = {_key(text) for text in request.known}
    facts: List[ExtractedFact] = []
    dropped = 0
    for fact in out.facts:
        text = " ".join(fact.text.split())
        if not text:
            continue
        if not 1 <= fact.page <= len(request.pages):
            dropped += 1
            continue
        if fact.section not in SECTIONS:
            # Filed under a section we don't show ("press"): left out, not failed.
            continue
        key = _key(text)
        if key in known:
            continue
        known.add(key)
        page = request.pages[fact.page - 1]
        facts.append(
            ExtractedFact(
                section=LearnedSection(fact.section),
                text=text[:_FACT_MAX_CHARS],
                source_url=page.url,
                source_title=page.title,
            )
        )
    return ExtractResponse(
        facts=facts,
        dropped=dropped,
        findings=findings(facts),
        business_name=" ".join(out.business_name.split())[:120],
    )


def _key(text: str) -> str:
    return re.sub(r"\W+", " ", text.lower()).strip()


def findings(facts: Sequence[ExtractedFact]) -> List[str]:
    """Copy §3's live lines for what this batch found."""
    counts: Dict[LearnedSection, int] = {}
    for fact in facts:
        counts[fact.section] = counts.get(fact.section, 0) + 1
    return [
        line.format(n=counts[section])
        for section, line in catalogue.FINDINGS.items()
        if counts.get(section)
    ]


# --- classify ----------------------------------------------------------------


async def classify(
    request: BuilderStepRequest, timeout: float
) -> Tuple[Industry, List[CareTopic]]:
    """The kind of business, and the topics it deals with that call for care. Neither
    is the pack: ally-be picks that from both, in code."""
    out = await call(
        "classify",
        ClassifyOut,
        LLMTask.ONBOARDING_CLASSIFY,
        prompts=request.prompts,
        timeout=timeout,
        learned=format_learned(request.learned),
        description=request.description or "(none)",
        pages=format_pages(request.pages, snippets=False),
    )
    known = {topic.value for topic in CareTopic}
    topics = [CareTopic(t) for t in dict.fromkeys(out.care_topics) if t in known]
    return out.industry, topics


# --- gaps --------------------------------------------------------------------


async def find_gaps(
    request: BuilderStepRequest, industry: Industry, timeout: float
) -> List[Gap]:
    """The industry's checklist items the business hasn't answered, in checklist
    order, then the site's own; at most MAX_GAPS."""
    checklist = catalogue.GAP_CHECKLISTS.get(
        industry, catalogue.GAP_CHECKLISTS[Industry.OTHER]
    )
    out = await call(
        "gaps",
        GapsOut,
        LLMTask.ONBOARDING_GAPS,
        prompts=request.prompts,
        timeout=timeout,
        checklist="\n".join(f"{check.key}: {check.item}" for check in checklist),
        learned=format_learned(request.learned),
        answers=format_answers(request.answers, FIXED_LABELS),
        pages=format_pages(request.pages, snippets=False),
    )
    missing = set(out.missing)
    gaps = [
        Gap(key=check.key, item=check.item, why=check.why)
        for check in checklist
        if check.key in missing
    ]
    for n, extra in enumerate(out.extra[:2], 1):
        item = " ".join(extra.item.split()).rstrip(".")
        why = " ".join(extra.why.split())
        if not item or catalogue.overpromises(item):
            continue
        # "your fees for sessions" after "your fees" is the same question twice.
        if any(_words(item) & _words(gap.item) for gap in gaps):
            continue
        if why and not why.endswith("."):
            why += "."
        gaps.append(Gap(key=f"site_{n}", item=item[:200], why=why[:200]))
    return gaps[: catalogue.MAX_GAPS]


_FILLER = {
    "your",
    "the",
    "a",
    "an",
    "for",
    "and",
    "or",
    "of",
    "to",
    "how",
    "what",
    "whether",
    "which",
    "when",
    "people",
    "can",
    "you",
    "are",
    "is",
    "it",
    "they",
    "in",
    "on",
    "with",
    "do",
    "does",
}


def _words(text: str) -> set:
    """The words that say what a gap is about ("fees", "cancellation")."""
    return {w.rstrip("s") for w in re.findall(r"[a-z]+", text.lower())} - _FILLER


# --- purposes (chunk 20a-2) ---------------------------------------------------


async def propose_purposes(
    request: BuilderStepRequest, timeout: float
) -> List[DesignCard]:
    """The five purpose cards, the recommended one first and badged, Something else
    last. What each will and won't do comes from the catalogue; the model picks the
    recommended one (from the first two for this business) and tailors "Best for" and
    the sample. A sample that isn't grounded falls back to the catalogue's."""
    for_team = (request.answers.get("audience") or "") == "My team"
    order = catalogue.purpose_order(request.industry, for_team)
    suggested = order[:2]
    out = await call(
        "purposes",
        PurposesOut,
        LLMTask.ONBOARDING_PURPOSES,
        prompts=request.prompts,
        timeout=timeout,
        suggested=", ".join(p.value for p in suggested),
        learned=format_learned(request.learned),
        audience=request.answers.get("audience") or "(not said)",
    )
    recommended = PurposeId(out.recommended.value)
    if recommended not in suggested:
        recommended = suggested[0]
    tailored = {PurposeId(card.id.value): card for card in out.cards}
    source = corpus(request)
    ranked = [recommended] + [p for p in order if p != recommended]
    cards = [
        _purpose_card(purpose, tailored.get(purpose), source, purpose == recommended)
        for purpose in ranked
    ]
    custom = catalogue.PURPOSES[PurposeId.CUSTOM]
    cards.append(
        DesignCard(
            id=PurposeId.CUSTOM.value,
            title=custom.name,
            best_for=custom.one_liner,
            will=[],
            wont=[],
            sample=[],
        )
    )
    return cards


def _purpose_card(
    purpose_id: PurposeId, proposal: Any, source: str, recommended: bool
) -> DesignCard:
    purpose = catalogue.PURPOSES[purpose_id]
    best_for = _clean(getattr(proposal, "best_for", ""), 100)
    if not best_for or ungrounded(best_for, source):
        best_for = purpose.one_liner
    visitor, assistant = split_turn(
        _clean(getattr(proposal, "visitor_line", ""), 160),
        _clean(getattr(proposal, "assistant_line", ""), 240),
    )
    if (
        not visitor
        or not assistant
        or catalogue.overpromises(assistant)
        or not sample_grounded(f"{visitor}\n{assistant}", source)
    ):
        sample = [{"from": who, "text": text} for who, text in purpose.default_sample]
    else:
        sample = [
            {"from": "visitor", "text": visitor},
            {"from": "assistant", "text": assistant},
        ]
    return DesignCard(
        id=purpose_id.value,
        title=purpose.name,
        best_for=best_for,
        will=list(purpose.will),
        wont=list(purpose.wont),
        sample=sample,
        recommended=recommended,
        limit=purpose.limit,
    )


def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split()).rstrip("!")[:limit]


def split_turn(visitor: str, assistant: str) -> Tuple[str, str]:
    """One speaker per line. A visitor line that answers its own question ("How much
    is a session? It's ₹2,000.") keeps only the question; the answer becomes the
    assistant's line when it has none. An assistant line that starts by repeating the
    question loses the repeat."""
    mark = visitor.find("?")
    if mark != -1 and visitor[mark + 1 :].strip():
        rest = visitor[mark + 1 :].strip()
        visitor = visitor[: mark + 1]
        assistant = assistant or rest
    if visitor and assistant.lower().startswith(visitor.lower()):
        assistant = assistant[len(visitor) :].strip()
    return visitor, assistant


_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_LINK = re.compile(
    r"(?:https?://|www\.)[^\s,)]+|\b[\w-]+(?:\.[\w-]+)*\."
    r"(?:com|in|org|net|io|ai|co|uk|health|clinic)\b(?:/[^\s,)]*)?",
    re.IGNORECASE,
)


def sample_grounded(text: str, source: str) -> bool:
    """False when a sample states a number, email or link we were never given: the
    same rule as facts, so a card never shows the business something untrue."""
    if ungrounded(text, source):
        return False
    known = (source or "").lower()
    for found in _EMAIL.findall(text) + _LINK.findall(text):
        if found.lower().rstrip(".") not in known:
            return False
    return True


# --- draft -------------------------------------------------------------------

_RUN = re.compile(r"\d+")


def corpus(request: BuilderStepRequest) -> str:
    """Everything the builder may state: what we learned and what the owner said."""
    parts = [fact.text for fact in request.learned.facts]
    parts.extend(v for v in request.answers.values() if v)
    parts.append(request.description)
    parts.append(request.draft.ownerNotes)
    parts.extend(turn.text for turn in request.history if turn.role == "owner")
    return "\n".join(parts)


def ungrounded(text: str, source: str) -> bool:
    """True when `text` states a number (a price, phone, time, date) that `source`
    doesn't have. Numbers are compared as digit runs, so "98200 12345" in a fact
    grounds "9820012345" in a draft; single digits and "00" are too common to judge.
    """
    runs = set(_RUN.findall(source))
    joined = "".join(_RUN.findall(source))
    for number in _RUN.findall(text):
        if len(number) < 2 or number == "00":
            continue
        if number not in runs and number not in joined:
            return True
    return False


def keep_grounded(text: str, source: str) -> str:
    """`text` without any sentence that states a number we were never given."""
    sentences = re.split(r"(?<=[.!?])\s+|\n", text or "")
    kept = [s for s in sentences if s.strip() and not ungrounded(s, source)]
    joiner = "\n" if "\n" in (text or "") else " "
    return joiner.join(kept).strip()


_DETAIL = re.compile(
    r"\d{2,}"  # a price, phone, time or size
    r"|[\w.+-]+@[\w-]+\.[\w.]+"  # an email
    r"|https?://|www\.|\b[\w-]+\.(?:com|in|org|net|io|ai|example)\b",  # a link
    re.IGNORECASE,
)


def without_details(text: str) -> str:
    """`text` without any sentence carrying a number, email or link (chunk 20a-2).

    For the assistant's instructions: facts belong in the pages it searches and
    cites. A price or phone number in the instructions makes the agent write
    details no passage holds, which the check then strips or sends back, and that
    turned answers into declines in the 20a eval."""
    sentences = re.split(r"(?<=[.!?])\s+|\n", text or "")
    kept = [s for s in sentences if s.strip() and not _DETAIL.search(s)]
    joiner = "\n" if "\n" in (text or "") else " "
    return joiner.join(kept).strip()


#: What each "don't know" quick reply means for the decline wording: the detail
#: itself, from what we learned, never the chip's own words ("call Our phone number").
DECLINE_HINTS: Dict[str, str] = {
    "Our phone number": (
        "the business's phone number, written out exactly as in What we learned; if "
        "there is none, say to contact the team"
    ),
    "Our email": (
        "the business's email address, written out exactly as in What we learned; if "
        "there is none, say to contact the team"
    ),
    "Our front desk": "the front desk",
    "": "the team's contact details from What we learned",
}


#: What the draft is told about each purpose (the `design` variable of
#: builder/draft.txt; its text is unchanged).
PURPOSE_BRIEF: Dict[PurposeId, str] = {
    PurposeId.ANSWER: (
        "Answer questions: short, direct answers about the business, each with its "
        "source."
    ),
    PurposeId.ENQUIRIES: (
        "Bring in customers: helps people find the right service, asking one "
        "question at a time, then offers to pass their name and number to the "
        "business. It never promises a discount or a slot that isn't listed."
    ),
    PurposeId.TRAINING: (
        "Train my team: for the business's own staff. Explains procedures in short "
        "steps from the documents and quizzes staff when they ask."
    ),
    PurposeId.GUIDE: (
        "Guide people step by step: walks people through a process one step at a "
        "time, in the source's order, checking each step is done."
    ),
}


def purpose_brief(request: BuilderStepRequest, purpose: PurposeId) -> str:
    if purpose == PurposeId.CUSTOM:
        note = " ".join((request.draft.purposeNote or "").split())[:600]
        return f"Something else, in the owner's words: {note or '(not said)'}"
    return PURPOSE_BRIEF[purpose]


async def draft_assistant(
    request: BuilderStepRequest, purpose: PurposeId, timeout: float
) -> DraftOut:
    decline = (
        DECLINE_HINTS.get(
            request.answers.get("decline") or "", request.answers.get("decline") or ""
        )
        or DECLINE_HINTS[""]
    )
    audience = request.answers.get("audience") or ""
    tone_hint = (
        "plain and friendly, for the business's own team"
        if audience == "My team" or purpose == PurposeId.TRAINING
        else "warm and clear, for the business's clients or customers"
    )
    prechat_rule = (
        "exactly 3 short questions asked before the chat starts, to pass the "
        "person's details on: their name (text, required), then their phone number "
        '(phone, required), then "What are you looking for?" (choice, its options '
        "the services from What we learned, not required)."
        if purpose == PurposeId.ENQUIRIES
        else "leave empty: this assistant asks nothing before the chat."
    )
    out = await call(
        "draft",
        DraftOut,
        LLMTask.ONBOARDING_DRAFT,
        prompts=request.prompts,
        timeout=timeout,
        design=purpose_brief(request, purpose),
        learned=format_learned(request.learned),
        answers=format_answers(request.answers, answer_labels(request.gaps)),
        safety_pack=format_pack(request.safety_pack),
        tone_hint=tone_hint,
        prechat_rule=prechat_rule,
        decline_hint=decline,
    )
    return out


# --- the conversation step ---------------------------------------------------


async def converse(
    request: BuilderStepRequest,
    *,
    step_guide: str,
    pending: str,
    timeout: float,
) -> ConverseOut:
    message = request.message.strip()
    if request.chip:
        message = f"(chose) {request.chip}" + (f"\n{message}" if message else "")
    return await call(
        "system",
        ConverseOut,
        LLMTask.ONBOARDING_BUILDER_STEP,
        prompts=request.prompts,
        timeout=timeout,
        reasoning=True,
        step=request.step,
        step_guide=step_guide,
        safety_pack=format_pack(request.safety_pack),
        learned=format_learned(request.learned),
        answers=format_answers(request.answers, answer_labels(request.gaps)),
        draft=format_draft(request.draft),
        pages=format_pages(request.pages, snippets=False),
        history=format_history(request.history),
        pending=pending or "(none)",
        message=message or "(no message)",
    )
