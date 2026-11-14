"""One builder step: which sub-tasks run, and what is proposed back.

The order of questions, the quick replies, and every message the copy deck fixes are
decided here, in code; the model writes only the parts the deck leaves open, and
proposes values that code turns into JSON patches. ally-be then checks the patches
again (paths, schema, safety lock) before anything is written.
"""

from __future__ import annotations

import re
import time
from typing import Any, Callable, Dict, List, Optional, Sequence, Tuple
from uuid import uuid4

from app.core.builder import catalogue, grounding, purposes, tasks
from app.core.builder.schemas import ConverseOut, DraftOut, Tone
from app.schemas.builder import (
    PURPOSE_OF_DESIGN,
    BuilderStepRequest,
    BuilderStepResponse,
    Gap,
    Industry,
    PatchOp,
    PrechatFieldType,
    PurposeId,
)

OnEvent = Callable[[str, Dict[str, Any]], None]

#: What the builder may propose changes to: ally-be's DRAFT_PATHS for the builder.
#: Never the safety pack, the documents, the owner's own rules or the access list.
BUILDER_PATHS: Tuple[str, ...] = (
    "/name",
    "/assistantName",
    "/introduction",
    "/instructions",
    "/tone",
    "/languages",
    "/topics",
    "/ownerNotes",
    "/suggestedQuestions",
    "/prechat",
    "/declineText",
    "/branding",
    "/design",
    "/purpose",
    "/purposeNote",
)
#: ally-be's source for a detail the owner gave (bot-draft.service OWNER_SOURCE).
OWNER_SOURCE = "owner"

#: Status codes, as `status` events; clients map `code` to their own copy.
STATUS_LABELS: Dict[str, str] = {
    "thinking": "Reading your message",
    "classifying": "Working out your industry",
    "finding_gaps": "Checking what's missing",
    "designing": "Choosing designs",
    "drafting": "Writing your assistant",
    "writing": "Writing the reply",
}

#: What the model is told about each step; owner-facing lines are the deck's.
STEP_GUIDES: Dict[str, str] = {
    "start": (
        "The owner hasn't shared their website yet. Help them start: they can paste "
        "their website, upload documents or describe the business."
    ),
    "reading": (
        "We're reading the owner's website now; the canvas shows each page as it's "
        'read. If they ask, say: "Still reading. Large sites can take up to 2 '
        'minutes."'
    ),
    "learned": (
        'The owner is checking "What we learned". Every detail links to where we '
        "found it, and they can edit anything on the right. If they correct or add "
        "a detail, put it in `owner_facts`. When they're happy, set `step_done`."
    ),
    "safety": "The safety pack has just been turned on.",
    "gaps": (
        "You're asking the owner a few quick questions. Record their answer to the "
        "question asked last in `answer`. Write only a short acknowledgement in "
        "`message` (at most one sentence); the app adds the next question itself."
    ),
    "design": (
        "The owner is choosing what their assistant is for from the cards: answer "
        "questions, bring in customers, train their team, guide people step by step, "
        "or something else. Answer their question about the choice in one or two "
        "sentences. Booking and payments are coming soon, not available."
    ),
    "building": "The assistant is being built.",
    "share": (
        "The assistant is built. The owner is choosing who can use it, then "
        "publishing it to get a link. They can still ask for changes."
    ),
    "published": "The assistant is live. The owner can still ask for changes.",
}

_SKIPPED = "Skipped"
_NOT_OFFERED = "Not offered"


class Deadline:
    """Seconds left of the step's budget, for each sub-task's own timeout."""

    def __init__(self, seconds: float):
        self.ends = time.monotonic() + seconds

    def left(self) -> float:
        return max(self.ends - time.monotonic(), 1.0)


# --- questions ---------------------------------------------------------------


def question_queue(gaps: Sequence[Gap]) -> List[Tuple[str, str, List[str]]]:
    """Every question, in the order it's asked: the gaps, then the fixed three."""
    queue = [
        (
            gap.key,
            catalogue.GAP_MESSAGE.format(item=gap.item, why=gap.why).strip(),
            list(catalogue.GAP_CHIPS),
        )
        for gap in gaps
    ]
    for key, text, chips in catalogue.FIXED_QUESTIONS:
        if key == "languages":
            text = f"{text} {catalogue.LANGUAGE_NOTE}"
        queue.append((key, text, list(chips)))
    return queue


def unanswered(
    gaps: Sequence[Gap], answers: Dict[str, str]
) -> List[Tuple[str, str, List[str]]]:
    return [q for q in question_queue(gaps) if not answers.get(q[0])]


def language_tags(text: str) -> List[str]:
    """Language names (or BCP-47 tags) in `text`, as tags; [] if any is unknown."""
    names = [
        part.strip().lower()
        for part in re.split(r",|\band\b|&|/|\+", text or "")
        if part.strip()
    ]
    tags: List[str] = []
    for name in names:
        tag = catalogue.LANGUAGE_TAGS.get(name) or (
            name if name in catalogue.LANGUAGE_TAGS.values() else None
        )
        if not tag:
            return []
        if tag not in tags:
            tags.append(tag)
    return tags[:8]


# --- patches -----------------------------------------------------------------


def replace(path: str, value: Any) -> PatchOp:
    return PatchOp(op="replace", path=path, value=value)


def proposal_patches(out: ConverseOut, source: str) -> List[PatchOp]:
    """The conversation step's proposed changes, as patches."""
    patches: List[PatchOp] = []
    if out.name.strip():
        patches.append(replace("/name", out.name.strip()[:120]))
    if out.assistant_name.strip():
        name = out.assistant_name.strip()[:60]
        patches.append(replace("/assistantName", name))
        patches.append(replace("/branding/assistantName", name))
    if out.tone != Tone.UNCHANGED:
        patches.append(replace("/tone", out.tone.value))
    if out.languages:
        tags = language_tags(", ".join(out.languages))
        if tags:
            patches.append(replace("/languages", tags))
    decline = grounding.keep_grounded(out.decline_text.strip(), source)
    if decline:
        patches.append(replace("/declineText", decline[:600]))
    return patches


def owner_fact_patches(out: ConverseOut) -> List[PatchOp]:
    """Details the owner gave in chat, for "What we learned", sourced to them."""
    return [
        PatchOp(
            op="add",
            path="/facts/-",
            value={
                "id": str(uuid4()),
                "section": fact.section.value,
                "text": " ".join(fact.text.split())[:500],
                "sourceUrl": OWNER_SOURCE,
                "sourceTitle": None,
                "byOwner": True,
            },
        )
        for fact in out.owner_facts
        if fact.text.strip()
    ]


def draft_patches(
    out: DraftOut, purpose: PurposeId, source: str, current_decline: str
) -> List[PatchOp]:
    """The drafted assistant, as patches. Any sentence with a number we were never
    given is dropped; pre-chat questions only for Bring in customers."""
    patches: List[PatchOp] = []
    name = " ".join(out.assistant_name.split())[:60]
    if name:
        patches += [
            replace("/assistantName", name),
            replace("/branding/assistantName", name),
        ]
    introduction = catalogue.honest_about_booking(
        grounding.keep_grounded(out.introduction, source)
    )[:600]
    if introduction:
        patches.append(replace("/introduction", introduction))
    instructions = grounding.without_details(
        catalogue.honest_about_booking(
            grounding.keep_grounded(out.instructions, source)
        )
    )[:4000]
    if instructions:
        patches.append(replace("/instructions", instructions))
    if out.tone != Tone.UNCHANGED:
        patches.append(replace("/tone", out.tone.value))
    topics = _unique(" ".join(t.split())[:80] for t in out.topics)[:12]
    patches.append(replace("/topics", topics))
    suggested = _unique(
        " ".join(q.split())[:120]
        for q in out.suggested_questions
        if not grounding.ungrounded(q, source)
    )[:4]
    patches.append(replace("/suggestedQuestions", suggested))
    patches.append(
        replace("/prechat", prechat(out) if purpose == PurposeId.ENQUIRIES else [])
    )
    decline = grounding.keep_grounded(out.decline_text, source)[:600]
    if decline or not current_decline:
        patches.append(replace("/declineText", decline))
    return patches


def prechat(out: DraftOut) -> List[Dict[str, Any]]:
    fields: List[Dict[str, Any]] = []
    for n, field in enumerate(out.prechat[:8], 1):
        label = " ".join(field.label.split())[:200]
        if not label:
            continue
        kind = field.type
        options = _unique(o.strip()[:80] for o in field.options)[:12]
        if kind == PrechatFieldType.CHOICE and len(options) < 2:
            kind = PrechatFieldType.TEXT
        if kind == PrechatFieldType.CONSENT:
            # Consent wording is the owner's to write, not the builder's.
            continue
        entry: Dict[str, Any] = {
            "id": f"q{n}",
            "label": label,
            "type": kind.value,
            "required": bool(field.required),
        }
        if kind == PrechatFieldType.CHOICE:
            entry["options"] = options
        fields.append(entry)
    return fields


def _unique(items) -> List[str]:
    seen, out = set(), []
    for item in items:
        if item and item.lower() not in seen:
            seen.add(item.lower())
            out.append(item)
    return out


def allowed(patches: Sequence[PatchOp]) -> Tuple[List[PatchOp], int]:
    """Only patches on the builder's paths; the rest are dropped and counted."""
    kept = [
        p
        for p in patches
        if any(
            p.path == root or p.path.startswith(f"{root}/") for root in BUILDER_PATHS
        )
    ]
    return kept, len(patches) - len(kept)


def with_note(notes: str, item: str, answer: str) -> str:
    """Owner notes with one more line for a gap the owner answered."""
    line = f"{item[:1].upper()}{item[1:]}: {answer}"
    return f"{notes.rstrip()}\n{line}".strip()[:20000]


# --- the step ----------------------------------------------------------------


class Step:
    """One run of `run_step`, holding what it will propose."""

    def __init__(self, request: BuilderStepRequest, on_event: Optional[OnEvent]):
        self.request = request
        self.on_event = on_event
        self.deadline: Deadline
        self.patches: List[PatchOp] = []
        self.learned_patches: List[PatchOp] = []
        self.source = tasks.corpus(request)

    def status(self, code: str) -> None:
        if self.on_event:
            self.on_event("status", {"code": code, "label": STATUS_LABELS[code]})

    async def converse(self, pending: str = "") -> ConverseOut:
        self.status("thinking")
        out = await tasks.converse(
            self.request,
            step_guide=STEP_GUIDES.get(self.request.step, ""),
            pending=pending,
            timeout=self.deadline.left(),
        )
        self.patches += proposal_patches(out, self.source)
        self.learned_patches += owner_fact_patches(out)
        if out.owner_facts:
            self.source += "\n" + "\n".join(f.text for f in out.owner_facts)
        return out

    def respond(self, **fields: Any) -> BuilderStepResponse:
        patches, dropped = allowed(self.patches)
        return BuilderStepResponse(
            patches=patches,
            learned_patches=self.learned_patches,
            dropped_patches=dropped,
            **fields,
        )


async def run_step(
    request: BuilderStepRequest, on_event: Optional[OnEvent] = None, *, budget: float
) -> BuilderStepResponse:
    step = Step(request, on_event)
    step.deadline = Deadline(budget)
    handler = {
        "learned": _learned,
        "gaps": _gaps,
        "design": _design,
        "building": _building,
    }.get(request.step, _talk)
    return await handler(step)


async def _talk(step: Step) -> BuilderStepResponse:
    """Any step without its own flow: answer, apply what the owner asked, stay."""
    out = await step.converse()
    return step.respond(
        message=out.message, chips=out.chips[:5], next_step=step.request.step
    )


async def _learned(step: Step) -> BuilderStepResponse:
    request = step.request
    ack = ""
    if request.chip != catalogue.LOOKS_RIGHT:
        out = await step.converse()
        if not out.step_done:
            return step.respond(
                message=out.message,
                chips=out.chips[:4] or [catalogue.LOOKS_RIGHT],
                next_step="learned",
            )
        ack = out.message
    step.status("classifying")
    industry, care_topics = await tasks.classify(request, step.deadline.left())
    step.status("finding_gaps")
    gaps = await tasks.find_gaps(request, industry, step.deadline.left())
    # ally-be turns the pack on (and says so, in the pack's own words) between this
    # step and the first question.
    return _ask(
        step,
        gaps,
        dict(request.answers),
        ack=ack,
        industry=industry,
        care_topics=care_topics,
    )


def _ask(
    step: Step,
    gaps: List[Gap],
    answers: Dict[str, str],
    *,
    ack: str = "",
    answer: str = "",
    **fields: Any,
) -> BuilderStepResponse:
    queue = unanswered(gaps, answers)
    key, text, chips = queue[0]
    message = f"{ack.strip()}\n\n{text}" if ack.strip() else text
    return step.respond(
        message=message,
        chips=chips,
        next_step="gaps",
        questions_left=len(queue),
        asking=key,
        answer=answer,
        gaps=gaps,
        **fields,
    )


async def _gaps(step: Step) -> BuilderStepResponse:
    request = step.request
    if request.gaps is None:
        # Resumed before the gaps were found.
        step.status("finding_gaps")
        gaps = await tasks.find_gaps(
            request, request.industry or Industry.OTHER, step.deadline.left()
        )
        return _ask(step, gaps, dict(request.answers))
    gaps = list(request.gaps)
    answers = dict(request.answers)
    pending = request.pending
    items = {gap.key: gap.item for gap in gaps}
    chip = request.chip
    answer, ack = "", ""

    if chip == "Skip for now":
        answer = _SKIPPED
    elif chip == "We don't offer this":
        answer = _NOT_OFFERED
    elif pending == "audience" and chip in catalogue.AUDIENCE_CHIPS:
        answer = chip
    elif pending == "decline" and chip in catalogue.DECLINE_CHIPS[:3]:
        answer = chip
    elif pending == "languages" and chip and language_tags(chip):
        answer = chip
    else:
        label = items.get(pending) or dict(
            (k, t) for k, t, _ in catalogue.FIXED_QUESTIONS
        ).get(pending, "")
        out = await step.converse(pending=label)
        answer = out.answer.strip()
        ack = out.message
        if not answer or chip == "Add it now":
            # Not an answer yet ("Add it now", or a question of their own): stay on
            # this question.
            current = next(
                (q for q in unanswered(gaps, answers) if q[0] == pending), None
            )
            chips = current[2] if current else []
            return step.respond(
                message=out.message,
                chips=[c for c in chips if c != "Add it now"],
                next_step="gaps",
                questions_left=len(unanswered(gaps, answers)),
                asking=pending,
                gaps=gaps,
            )

    if pending:
        answers[pending] = answer
        if pending in items and answer != _SKIPPED:
            note = "not offered" if answer == _NOT_OFFERED else answer
            notes = with_note(request.draft.ownerNotes, items[pending], note)
            step.patches.append(replace("/ownerNotes", notes))
        if pending == "languages":
            tags = language_tags(answer)
            if tags:
                step.patches.append(replace("/languages", tags))

    if unanswered(gaps, answers):
        return _ask(step, gaps, answers, ack=ack, answer=answer)

    step.status("designing")
    request.answers = answers
    designs = await tasks.propose_purposes(request, step.deadline.left())
    message = purposes.PURPOSE_MESSAGE
    if ack.strip():
        message = f"{ack.strip()}\n\n{message}"
    return step.respond(
        message=message,
        chips=[],
        next_step="design",
        answer=answer,
        gaps=gaps,
        designs=designs,
    )


def _offered_ids(step: Step) -> set:
    return {card.id for card in step.request.designs or [] if not card.coming_soon}


def _chosen_purpose(step: Step) -> Tuple[bool, Optional[PurposeId]]:
    """Whether the owner tapped a card, and the purpose on it (None for a card that
    can't be chosen). A draft offered the 20a-1 designs (no "answer" card) keeps
    working: its design maps to a purpose, so its "guide" stays Answer questions."""
    chip = step.request.chip
    prefix = next((p for p in ("purpose:", "design:") if chip.startswith(p)), "")
    if not prefix:
        return False, None
    value = chip.removeprefix(prefix)
    if value not in _offered_ids(step):
        return True, None
    if PurposeId.ANSWER.value not in _offered_ids(step):
        return True, PURPOSE_OF_DESIGN.get(value)
    try:
        return True, PurposeId(value)
    except ValueError:
        return True, None


async def _design(step: Step) -> BuilderStepResponse:
    request = step.request
    if request.designs is None:
        step.status("designing")
        designs = await tasks.propose_purposes(request, step.deadline.left())
        return step.respond(
            message=purposes.PURPOSE_MESSAGE, next_step="design", designs=designs
        )
    tapped, chosen = _chosen_purpose(step)
    if tapped and chosen is None:
        return step.respond(message=purposes.PURPOSE_MESSAGE, next_step="design")
    if chosen is None:
        note = " ".join(request.message.split())[:600]
        if request.draft.purpose == PurposeId.CUSTOM and note:
            # "Something else": the owner's sentence is the purpose.
            step.patches.append(replace("/purposeNote", note))
            request.draft.purposeNote = note
            return await _build(step, PurposeId.CUSTOM)
        out = await step.converse()
        return step.respond(message=out.message, next_step="design")
    step.patches.append(replace("/purpose", chosen.value))
    if chosen == PurposeId.CUSTOM:
        return step.respond(message=purposes.CUSTOM_PROMPT, next_step="design")
    return await _build(step, chosen)


async def _building(step: Step) -> BuilderStepResponse:
    return await _build(step, step.request.draft.chosen_purpose())


async def _build(step: Step, purpose: PurposeId) -> BuilderStepResponse:
    step.status("drafting")
    out = await tasks.draft_assistant(step.request, purpose, step.deadline.left())
    step.patches += draft_patches(
        out, purpose, step.source, step.request.draft.declineText
    )
    return step.respond(message=catalogue.BUILT_MESSAGE, next_step="share")
