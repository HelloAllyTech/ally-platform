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

    block = load_and_format(
        _TEMPLATE,
        prompt_data,
        state_guidance=guidance or _NO_STATE_GUIDANCE,
        stance=memory.stance,
        affect=memory.affect.strip(),
        register=memory.register.strip() or _NO_REGISTER,
        speech_fragments=_bullets(memory.speech_fragments, _NO_FRAGMENTS),
        withheld_section=_render_withheld(memory.withheld),
        unresolved_section=_render_unresolved(memory.unresolved),
        disclosed_section=_render_facts(
            memory.disclosed, _NO_DISCLOSED, MAX_RENDERED_DISCLOSURES
        ),
        salient_section=_render_facts(memory.salient_backstory, _NO_SALIENT),
    ).strip()

    logger.debug(
        "[working-memory] rendered block: %d chars stance=%s turn=%d "
        "staleness=%d withheld=%d open_threads=%d salient=%d",
        len(block),
        memory.stance,
        memory.turn_index,
        memory.staleness_turns,
        len(memory.withheld),
        len(memory.open_threads),
        len(memory.salient_backstory),
    )
    return block
