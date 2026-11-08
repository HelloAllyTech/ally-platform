"""The builder's sub-tasks: one structured model call each, then the checks that make
what comes back safe to propose.

What the model may decide is kept small on purpose. It never picks the safety pack
(ally-be maps the industry), never names a draft path (code builds the patches), and
never says what a design will do (that is fixed in the catalogue).
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Sequence, Type, TypeVar

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
    DesignsOut,
    DraftOut,
    ExtractOut,
    GapsOut,
)
from app.core.config import settings
from app.core.llm.dispatch import generate_structured
from app.core.llm_usage.tasks import LLMTask
from app.exceptions.custom_exceptions import LLMInvocationFailedException
from app.prompts.resolver import get_backend_llm_overrides, load_and_format
from app.schemas.builder import (
    BuilderStepRequest,
    DesignCard,
    DesignId,
    ExtractedFact,
    ExtractRequest,
    ExtractResponse,
    Gap,
    Industry,
    LearnedSection,
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


async def classify(request: BuilderStepRequest, timeout: float) -> Industry:
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
    return out.industry


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
        if why and not why.endswith("."):
            why += "."
        gaps.append(Gap(key=f"site_{n}", item=item[:200], why=why[:200]))
    return gaps[: catalogue.MAX_GAPS]


# --- designs -----------------------------------------------------------------


def offered_designs(industry: Optional[Industry]) -> List[DesignId]:
    return catalogue.DESIGNS_FOR.get(industry, catalogue.DEFAULT_DESIGNS)


async def propose_designs(
    request: BuilderStepRequest, timeout: float
) -> List[DesignCard]:
    """2–3 designs that work today, then the coming-soon card. The model names them
    and writes a sample; what each will and won't do comes from the catalogue."""
    offered = offered_designs(request.industry)
    out = await call(
        "designs",
        DesignsOut,
        LLMTask.ONBOARDING_DESIGNS,
        prompts=request.prompts,
        timeout=timeout,
        offered=", ".join(design.value for design in offered),
        learned=format_learned(request.learned),
        audience=request.answers.get("audience") or "(not said)",
    )
    cards: List[DesignCard] = []
    seen = set()
    for proposal in out.designs:
        if proposal.id not in offered or proposal.id in seen:
            continue
        seen.add(proposal.id)
        cards.append(_card(proposal.id, proposal))
        if len(cards) == 3:
            break
    # Never fewer than two real choices.
    for design_id in offered:
        if len(cards) >= 2:
            break
        if design_id not in seen:
            seen.add(design_id)
            cards.append(_card(design_id, None))
    cards.append(
        DesignCard(
            id=catalogue.COMING_SOON_ID,
            title="Booking and payments",
            best_for=catalogue.COMING_SOON_BODY,
            will=[],
            wont=[],
            sample=[],
            coming_soon=True,
        )
    )
    return cards


def _card(design_id: DesignId, proposal: Any) -> DesignCard:
    design = catalogue.DESIGNS[design_id]
    title = _clean(getattr(proposal, "title", ""), 40) or design.default_title
    best_for = _clean(getattr(proposal, "best_for", ""), 100) or design.default_best_for
    visitor = _clean(getattr(proposal, "visitor_line", ""), 160)
    assistant = _clean(getattr(proposal, "assistant_line", ""), 240)
    if not visitor or not assistant or catalogue.overpromises(assistant):
        sample = [{"from": who, "text": text} for who, text in design.default_sample]
    else:
        sample = [
            {"from": "visitor", "text": visitor},
            {"from": "assistant", "text": assistant},
        ]
    return DesignCard(
        id=design_id.value,
        title=title,
        best_for=best_for,
        will=list(design.will),
        wont=list(design.wont),
        sample=sample,
    )


def _clean(text: str, limit: int) -> str:
    return " ".join((text or "").split()).rstrip("!")[:limit]


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


async def draft_assistant(
    request: BuilderStepRequest, design: DesignId, timeout: float
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
        if audience == "My team"
        else "warm and clear, for the business's clients or customers"
    )
    prechat_rule = (
        "2 or 3 short questions asked before the chat starts, to pass the person's "
        "details on: their name (text, required), then an email or phone number "
        "(email or phone, required), then at most one question that helps the "
        "business follow up (choice, with its options, not required)."
        if design == DesignId.ENQUIRIES
        else "leave empty: this design asks nothing before the chat."
    )
    out = await call(
        "draft",
        DraftOut,
        LLMTask.ONBOARDING_DRAFT,
        prompts=request.prompts,
        timeout=timeout,
        design=design.value,
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
