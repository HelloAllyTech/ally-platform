"""Render the working-memory block that goes last in the prompt.

Two provenances are merged here and nowhere else (design §3.1):

- **derived** — stance, affect, register, fragments, ledgers, recalled memories,
  read from a store snapshot;
- **authored** — the active simulation state's `state_x_guidelines`, resolved
  per turn by ``_resolve_simulation_state_by_score`` and passed in.

The authored half is a parameter rather than a stored field on purpose. The
consolidation call rewrites what lives in the store, and a scenario designer's
instruction must never be paraphrased into an approximation of itself.

Ordering inside the block follows the same ascending-churn discipline
``prompt.py`` already applies to the volatile suffix — slowest first, so the most
stable bytes sit highest and the freshest content lands nearest generation:

    state guidance   only on a score-band crossing
    stance / affect  on a stance transition
    register / voice on a stance transition
    withheld         when a topic locks or unlocks
    unresolved       when a thread opens or closes
    disclosed        every turn something is said
    salient memories every recall refresh (~2 turns)

Two things are deliberately never rendered. ``appraisal`` is scratchpad — the
reason the stance is where it is, useful for telemetry and debugging, not
instruction (the ``think_scrubber`` rule, applied at assembly rather than before
TTS). And a withheld topic's CONTENT does not exist to render: unlike
``roleplay_v2``'s authored ledger, a derived ``WithheldTopic`` stores only the
topic and the deflection, so the material cannot leak because it was never
written down. The ledger here is a gate, not a content store — once a topic
unlocks, what the client actually says comes from memory like anything else.
"""

from __future__ import annotations

from typing import List, Optional, Sequence

from app.core.logger import get_logger
from app.core.working_memory.state import (
    ClientWorkingMemory,
    Fact,
    Thread,
    WithheldTopic,
)
from app.prompts.resolver import load_and_format

logger = get_logger(__name__)

_TEMPLATE = "system/client_working_memory"

# Named absences, never blanks. A blank section reads to the model as an absence
# of constraint; a named absence does not. Borrowed from roleplay_v2's empty
# states, which is the one part of that prompt surface that was always populated.
_NO_WITHHELD = "(nothing you are holding back right now)"
_NO_UNRESOLVED = "(nothing left hanging)"
_NO_DISCLOSED = "(you have not told them anything yet)"

#: How many disclosures the block RENDERS. The store keeps every one — the
#: write-out needs them all — but the prompt shows only the most recent.
#:
#: Measured, not guessed: the first v2v run ended a 10-exchange session with 21
#: disclosures, and the block had grown 1221 -> 2777 chars. That cost lands
#: twice, because the same ledger goes into the updater's digest, and the run's
#: numbers show it plainly — client_working_memory spent 18,629 prompt tokens
#: against agent_turn's 18,431, so the feature cost slightly MORE than the
#: conversation it serves. A 30-turn session would have been far worse.
#:
#: Most-recent rather than most-salient: this section exists to stop the actor
#: re-introducing something as new, and what it is most likely to repeat is what
#: it just said.
MAX_RENDERED_DISCLOSURES = 12


def _rendered_disclosure_cap() -> int:
    """The live cap, read per render so an A/B can move it by env var.

    Falls back to the module constant if the setting is absent, so importing
    this module never depends on config being loaded (several unit tests
    construct blocks directly).
    """
    try:
        from app.core.config import settings

        value = getattr(
            settings,
            "CLIENT_WORKING_MEMORY_MAX_RENDERED_DISCLOSURES",
            MAX_RENDERED_DISCLOSURES,
        )
        return int(value) if value else MAX_RENDERED_DISCLOSURES
    except Exception:  # noqa: BLE001 - a config problem must not break a turn
        return MAX_RENDERED_DISCLOSURES


_NO_SALIENT = "(nothing from your own life is on your mind this turn)"
_NO_FRAGMENTS = "(you have not spoken yet — this is your first reply)"
_NO_STATE_GUIDANCE = "(no particular direction for this stage)"
_NO_REGISTER = "(speak as this person naturally would)"


def _bullets(lines: Sequence[str], empty: str) -> str:
    kept = [line.strip() for line in lines if line and line.strip()]
    return "\n".join(f"- {line}" for line in kept) if kept else empty


def _render_withheld(items: Sequence[WithheldTopic]) -> str:
    """Topic and deflection only. There is no content field to leak."""
    lines: List[str] = []
    for item in items:
        if item.status == "revealed":
            continue  # already out; `disclosed` carries it now
        if item.status == "locked":
            deflection = item.deflection.strip() or "change the subject naturally"
            lines.append(
                f"{item.topic} — you have NOT talked about this and are not "
                f"ready to. If they push: {deflection}"
            )
        else:  # unlocked
            lines.append(
                f"{item.topic} — you could let this come out now, if the moment "
                f"genuinely fits. Do not volunteer it."
            )
    return _bullets(lines, _NO_WITHHELD)


def _render_unresolved(threads: Sequence[Thread]) -> str:
    open_threads = [t for t in threads if t.is_open]
    if not open_threads:
        return _NO_UNRESOLVED
    lines = [
        f"{t.topic} — still unfinished, and it is still on your mind"
        for t in open_threads
    ]
    return _bullets(lines, _NO_UNRESOLVED)


def _render_facts(facts: Sequence[Fact], empty: str, limit: int = 0) -> str:
    texts = [f.text for f in facts]
    if limit and len(texts) > limit:
        # Tail, not head: the oldest disclosures are the ones the rolling
        # summary already covers, and the newest are what the actor might repeat.
        texts = texts[-limit:]
    return _bullets(texts, empty)


def render_block(
    memory: ClientWorkingMemory,
    *,
    state_guidance: Optional[str] = None,
    prompt_data: object = None,
) -> str:
    """Render the block, or "" when there is nothing worth appending.

    Returns "" only when the memory is genuinely untouched AND no authored
    guidance came with it — a first turn with no state configured. Rendering the
    scaffolding with every section reading "(nothing yet)" would spend tokens to
    tell the model nothing.
    """
    has_derived = bool(
        memory.affect
        or memory.register
        or memory.speech_fragments
        or memory.disclosed
        or memory.unresolved
        or memory.withheld
        or memory.salient_backstory
    )
    guidance = (state_guidance or "").strip()
    if not has_derived and not guidance:
        return ""

    cap = _rendered_disclosure_cap()
    sections = {
        "state_guidance": guidance or _NO_STATE_GUIDANCE,
        "affect": memory.affect.strip(),
        "register": memory.register.strip() or _NO_REGISTER,
        "speech_fragments": _bullets(memory.speech_fragments, _NO_FRAGMENTS),
        "withheld_section": _render_withheld(memory.withheld),
        "unresolved_section": _render_unresolved(memory.unresolved),
        "disclosed_section": _render_facts(memory.disclosed, _NO_DISCLOSED, cap),
        "salient_section": _render_facts(memory.salient_backstory, _NO_SALIENT),
    }

    block = load_and_format(
        _TEMPLATE,
        prompt_data,
        stance=memory.stance,
        **sections,
    ).strip()

    # INFO, not DEBUG, and sized PER SECTION.
    #
    # Prod runs at INFO, so the old debug line was invisible exactly where the
    # question gets asked. And a single total could not answer it: the block
    # grew ~600 tokens over 7 turns in prod while every ledger stayed in single
    # digits — the disclosure cap of 12 never once bound. Without per-section
    # sizes the only way to find the growth is to guess a section and cap it,
    # which is how you end up tuning a knob that is not attached to the problem.
    logger.info(
        "[working-memory] rendered block: %d chars stance=%s turn=%d "
        "staleness=%d cap=%d | %s | counts withheld=%d open_threads=%d "
        "disclosed=%d salient=%d",
        len(block),
        memory.stance,
        memory.turn_index,
        memory.staleness_turns,
        cap,
        " ".join(f"{name}={len(text)}" for name, text in sections.items()),
        len(memory.withheld),
        len(memory.open_threads),
        len(memory.disclosed),
        len(memory.salient_backstory),
    )
    return block


#: The split form's placeholders, in the ascending-churn order the module
#: docstring describes. Ordering is advisory here in a way it is not for
#: ``render_block``: in the split form the AUTHOR decides where each field
#: lands, and that is the point of the form. It stays the order of this tuple
#: because the coverage log reads it, and a log that lists sections in a
#: different order than the reference prompt is a log people misread.
#:
#: `state_x_guidelines` is deliberately NOT here. It is the authored half
#: (§3.1) and it already had a placeholder of its own long before this module
#: existed; the split form simply stops swallowing it.
SECTION_VARIABLES = (
    "working_memory_stance",
    "working_memory_register",
    "working_memory_speech_fragments",
    "working_memory_withheld",
    "working_memory_unresolved",
    "working_memory_disclosed",
    "working_memory_salient",
)


def render_sections(memory: ClientWorkingMemory) -> dict:
    """Render the working memory as one value per placeholder (the split form).

    Same derived state as ``render_block``, cut along the boundaries a curator
    would want to move, and returned as a mapping rather than one string.

    Two differences from the block form, both deliberate:

    - **No whole-block short-circuit.** ``render_block`` returns "" when the
      memory is untouched, because rendering its own scaffolding to say
      "(nothing yet)" seven times would spend tokens to tell the model nothing.
      That option does not exist here: the headings are the author's text, so
      Python cannot suppress them, and a blanked value would leave a bare
      heading — which reads to the model as an absence of constraint in exactly
      the way `_NO_WITHHELD` and friends exist to prevent. So every section
      always renders, and renders a NAMED absence when it is empty. This is the
      module's own rule (see the `_NO_*` constants) applied to the one case the
      block form got to opt out of.

    - **Static instructions are absent.** Each value is the derived data and
      nothing else: the sentences that shape how the actor USES it — the
      earned-advance discipline, the do-not-re-introduce rule, the voice
      lead-in — are literal text in the prompt body. Baking them into the
      values here would hide the single most important instruction in the
      block behind a placeholder name, from exactly the people being asked to
      curate it. A versioned prompt with a revert-to-default button and a diff
      on every change does not need protecting from its own authors.

    - **State guidance is absent.** The block form takes `state_guidance` and
      renders it as its first section; the split form leaves it to the
      `{state_x_guidelines}` placeholder that already exists. That is the whole
      reason the split form was asked for: a designer looking at the prompt
      could not see their own state guidance in it any more.
    """
    cap = _rendered_disclosure_cap()
    affect = memory.affect.strip()
    stance_line = f"You are {memory.stance} right now."
    if affect:
        stance_line = f"{stance_line} {affect}"

    sections = {
        "working_memory_stance": stance_line,
        "working_memory_register": memory.register.strip() or _NO_REGISTER,
        "working_memory_speech_fragments": _bullets(
            memory.speech_fragments, _NO_FRAGMENTS
        ),
        "working_memory_withheld": _render_withheld(memory.withheld),
        "working_memory_unresolved": _render_unresolved(memory.unresolved),
        "working_memory_disclosed": _render_facts(memory.disclosed, _NO_DISCLOSED, cap),
        "working_memory_salient": _render_facts(memory.salient_backstory, _NO_SALIENT),
    }

    # The same per-section INFO line `render_block` emits, for the same reason.
    #
    # Without this the split form is a telemetry BLACKOUT: `render_block` is
    # never called, so a split session emits no size line at all, and the
    # question "which section is growing?" has no answer. That is not
    # hypothetical — the per-section sizes are what found the backstory bug,
    # where a single 1721-char fact was 64% of the block while every ledger
    # count looked healthy. Counts alone would not have shown it; a single
    # total would not have shown it either.
    #
    # Deliberately the same prefix and field names as the block form's line, so
    # one CloudWatch query covers both forms and a session can be compared
    # across them.
    logger.info(
        "[working-memory] rendered sections: %d chars total stance=%s turn=%d "
        "staleness=%d cap=%d | %s | counts withheld=%d open_threads=%d "
        "disclosed=%d salient=%d",
        sum(len(text) for text in sections.values()),
        memory.stance,
        memory.turn_index,
        memory.staleness_turns,
        cap,
        " ".join(
            f"{name.removeprefix('working_memory_')}={len(text)}"
            for name, text in sections.items()
        ),
        len(memory.withheld),
        len(memory.open_threads),
        len(memory.disclosed),
        len(memory.salient_backstory),
    )
    return sections
