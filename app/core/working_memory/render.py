"""Render the working memory as one value per prompt placeholder.

The derived half of design §3.1 — stance, affect, register, fragments, ledgers,
recalled memories — read from a store snapshot and cut into the seven sections
a main-agent prompt declares as `{working_memory_*}`.

The authored half (`state_x_guidelines`) is deliberately NOT here. It reaches
the prompt through its own placeholder, resolved per turn by
``_resolve_simulation_state_by_score``. A scenario designer's instruction must
never be paraphrased into an approximation of itself, and a designer must be
able to see their own guidance in the prompt they are reading.

There was a second renderer until 2026-08-31: ``render_block`` composed all of
this plus the authored guidance into one string behind a single
`{client_working_memory}` placeholder. It is gone. Two readers for one state
meant a curator could not tell from a prompt which was live, and the tie-break
when a prompt declared both (block wins, sections render bare) was a trap.
Ordering used to matter here for that reason — ascending churn, stablest bytes
first. It no longer does: in the split form the AUTHOR decides where each
section lands, which is the point of the form.

Two things are deliberately never rendered. ``appraisal`` is scratchpad — the
reason the stance is where it is, useful for telemetry and debugging, not
instruction (the ``think_scrubber`` rule, applied at assembly rather than before
TTS). And a withheld topic's CONTENT does not exist to render: unlike
``roleplay_v2``'s authored ledger, a derived ``WithheldTopic`` stores only the
topic and the deflection, so the material cannot leak because it was never
written down.
"""

from __future__ import annotations

from typing import List, Sequence

from app.core.logger import get_logger
from app.core.working_memory.state import (
    ClientWorkingMemory,
    Fact,
    Thread,
    WithheldTopic,
)

logger = get_logger(__name__)


# Named absences, never blanks. A blank section reads to the model as an absence
# of constraint; a named absence does not. Borrowed from roleplay_v2's empty
# states, which is the one part of that prompt surface that was always populated.
_NO_WITHHELD = "(nothing has been left unsaid so far)"
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
#: Public because the caller applies it, not this module. Authored guidance
#: reaches the prompt through the standalone `{state_x_guidelines}`
#: placeholder and never passes through here, so `prompt.py` substitutes this
#: when no state resolves. One string in one place: a bare heading and a
#: differently-worded absence are both failures this prevents.
NO_STATE_GUIDANCE = "(no particular direction for this stage)"
_NO_REGISTER = "(speak as this person naturally would)"


def _bullets(lines: Sequence[str], empty: str) -> str:
    kept = [line.strip() for line in lines if line and line.strip()]
    return "\n".join(f"- {line}" for line in kept) if kept else empty


def _render_locked(topics: Sequence[str]) -> List[str]:
    """Trainer-locked memories (``knowledge_locks.py``): title only.

    Unlike the derived items below, these ARE permissive-by-authority: the
    trainer's lock is the author's decision, keyed to the author's states, so
    saying "not ready" here is the state machine speaking — not a second
    controller. The content was dropped upstream and never reaches this
    function; there is nothing here that could leak it.
    """
    return [
        f"{topic} — you are not ready to talk about this yet. If it comes up, "
        "move away from it naturally without saying what it is"
        for topic in topics
        if topic and topic.strip()
    ]


def _render_withheld(
    items: Sequence[WithheldTopic], locked_topics: Sequence[str] = ()
) -> str:
    """Topic and deflection only. There is no content field to leak.

    **Descriptive, never permissive.** This section states what has not come up
    yet and how the client has moved away from it before; it does not say
    whether the client is ready to talk about it now. That call belongs to the
    author's `state_x_guidelines` and to nothing else.

    It used to say "you have NOT talked about this and are not ready to" while
    locked and "you could let this come out now" once unlocked, with the
    transition driven by the stance reaching the ladder's second-from-top rung.
    That made the ledger a second controller for disclosure: what to withhold
    was chosen by the updater rather than the author, and when to release it by
    a rung position rather than the author's states — so a scenario whose own
    guidance invited an early disclosure was overruled, and one whose later
    state was still guarded was contradicted. Same two-controllers shape as the
    stance ladder, one level down, and removed for the same reason.

    The deflection is kept because it is CONTINUITY, not permission: a client
    who sidestepped a subject by talking about work should sidestep it the same
    way next time rather than inventing a new evasion each turn. Whether to
    sidestep at all is the state's decision.
    """
    lines: List[str] = _render_locked(locked_topics)
    for item in items:
        if item.status == "revealed":
            continue  # already out; `disclosed` carries it now
        deflection = item.deflection.strip()
        line = f"{item.topic} — has not come up yet"
        if deflection:
            line += f". When you have moved away from it before: {deflection}"
        lines.append(line)
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


#: The placeholders this module fills. Order is advisory — the AUTHOR decides
#: where each section lands in the prompt body, which is the point of the
#: form. It stays in this order because the coverage log reads the tuple, and
#: a log listing sections in a different order than the reference prompt is a
#: log people misread.
#:
#: `state_x_guidelines` is deliberately NOT here. It is the authored half
#: (§3.1) with a placeholder of its own; this module never touches it.
SECTION_VARIABLES = (
    "working_memory_stance",
    "working_memory_register",
    "working_memory_speech_fragments",
    "working_memory_withheld",
    "working_memory_unresolved",
    "working_memory_disclosed",
    "working_memory_salient",
)


def render_sections(
    memory: ClientWorkingMemory, locked_topics: Sequence[str] = ()
) -> dict:
    """Render the derived memory as one value per placeholder.

    Cut along the boundaries a curator would want to move, and returned as a
    mapping rather than one string.

    Three properties worth stating, all of them deliberate:

    - **Every section always renders, and renders a NAMED absence when empty.**
      There is no whole-block short-circuit available: the headings are the
      author's text, so Python cannot suppress them, and a blanked value would
      leave a bare heading — which reads to the model as an absence of
      constraint in exactly the way `_NO_WITHHELD` and friends exist to
      prevent. (The retired block renderer could return "" for an untouched
      memory, because it owned its own scaffolding. This does not.)

    - **Static instructions are absent.** Each value is the derived data and
      nothing else: the sentences that shape how the actor USES it — the
      do-not-re-introduce rule, the voice lead-in — are literal text in the
      prompt body. Baking them in here would hide the single most important
      instruction behind a placeholder name, from exactly the people being
      asked to curate it. A versioned prompt with a revert-to-default button
      and a diff on every change does not need protecting from its authors.

    - **Locked memories render as titles only.** `locked_topics` are the
      titles of Knowledge Sources a trainer locked to a later state; they join
      the withheld section ahead of the derived items. They are authored, so
      they are passed in per render and never enter the store (§3.1).

    - **State guidance is absent.** It goes through `{state_x_guidelines}`.
      That is the whole reason this form exists: a designer looking at the
      prompt could not see their own state guidance in it any more.
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
        "working_memory_withheld": _render_withheld(memory.withheld, locked_topics),
        "working_memory_unresolved": _render_unresolved(memory.unresolved),
        "working_memory_disclosed": _render_facts(memory.disclosed, _NO_DISCLOSED, cap),
        "working_memory_salient": _render_facts(memory.salient_backstory, _NO_SALIENT),
    }

    # Per-section sizes, at INFO because prod runs at INFO and this is where
    # the question gets asked.
    #
    # Sized per section rather than as one total, and that is not a nicety: the
    # per-section sizes are what found the backstory bug, where a single
    # 1721-char fact was 64% of the block while every ledger count looked
    # healthy. Counts alone would not have shown it; a single total would not
    # have shown it either.
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
