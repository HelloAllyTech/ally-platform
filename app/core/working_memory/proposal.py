"""What the updater LLM returns, and what code does with it.

The division here is the whole point, and it is salvaged from
``roleplay_v2``'s ``DirectorService._apply`` (design §9.1): **the LLM proposes,
code disposes.** In v2 the verdict was advisory and re-validated before commit —
scores came from rubric weights and never from the model, transitions were
accepted only through a satisfied guard, stage directions were truncated, and
time-based events never came from the LLM at all.

§3 says a stance transition must be **earned** but does not say who enforces
that. This module is the answer. Without it "earned" is a word in a prompt, and
the failure in §1 — a client declaring insight at turn 14 and handing the trainee
a fake success — is exactly what a model does when it is asked nicely.

So ``ProposedUpdate`` is untrusted input that happens to arrive as structured
output, and ``validate`` decides what actually happens.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import List, Optional, Tuple

from pydantic import BaseModel, Field

from app.core.logger import get_logger
from app.core.working_memory.state import STANCES, ClientWorkingMemory, Stance

logger = get_logger(__name__)

#: The stance ladder, in order. Advancing means moving right, and only ever one
#: rung at a time: a client does not go from guarded to reflecting because one
#: question landed well.
STANCE_ORDER: Tuple[Stance, ...] = STANCES

#: Minimum turns in a stance before it may be left by ADVANCING. v2's
#: `minTurnsInState`, and it exists for the same reason: without it the actor
#: oscillates, opening up and closing down turn to turn, which reads as
#: instability rather than as a person.
#:
#: Invented, like everything in §7.3 — but bounded by a measurement: the depth
#: curve inflects at turns 8–11, so a ladder of five stances gated at 2 turns
#: each cannot reach the top before the inflection, and gating at 3 makes
#: `reflecting` unreachable inside a median session.
MIN_TURNS_BEFORE_ADVANCE = 2

#: Events that can earn an advance. `repair` and `resistance_softened` are the
#: two the design names as advancing (§4); `disclosed` counts because revealing
#: something new IS the client opening up, not merely a bookkeeping event.
ADVANCING_EVENTS = frozenset({"repair", "resistance_softened", "disclosed"})

#: Events that force a regression regardless of anything else. There is no
#: minimum-turns gate on the way down: a client who feels judged closes up
#: immediately, and making them wait two turns for it would be the same
#: uniform-responsiveness failure §1 measures from the other direction.
REGRESSING_EVENTS = frozenset({"rupture"})

CLIENT_EVENTS = frozenset(
    ADVANCING_EVENTS
    | REGRESSING_EVENTS
    | {"withheld", "affect_shift", "thread_opened", "thread_closed"}
)

#: Cap on a rendered voice fragment. Long enough to carry a speech habit, short
#: enough that the model cannot smuggle a whole reply in as "voice".
MAX_FRAGMENT_CHARS = 120
MAX_FRAGMENTS = 3


class ObservedEvent(BaseModel):
    """One client-side event the updater claims to have seen."""

    kind: str = Field(description="One of the client-side event kinds (§4).")
    topic: str = Field(default="", description="Subject, where the kind has one.")
    evidence: str = Field(
        default="",
        description="The span that justifies it — for review, not for the prompt.",
    )


class ProposedUpdate(BaseModel):
    """The updater's structured output. Untrusted; see ``validate``."""

    events: List[ObservedEvent] = Field(default_factory=list)
    stance: Optional[str] = Field(
        default=None, description="Proposed stance. Advisory — code decides."
    )
    affect: Optional[str] = None
    appraisal: Optional[str] = None
    #: Named `voice_register` rather than `register`, which shadows an attribute
    #: on pydantic's BaseModel — the model still loads with the shadowing name
    #: but warns, and a field that quietly collides with framework internals is
    #: not worth the tidier spelling. The stored field stays `register`.
    voice_register: Optional[str] = None
    speech_fragments: List[str] = Field(default_factory=list)
    disclosed: List[str] = Field(default_factory=list)
    withheld_topics: List[str] = Field(default_factory=list)
    withheld_deflections: List[str] = Field(default_factory=list)
    opened_threads: List[str] = Field(default_factory=list)
    closed_threads: List[str] = Field(default_factory=list)
    retrieve_cues: List[str] = Field(default_factory=list)


@dataclass
class ValidatedUpdate:
    """What code decided to commit, and why the stance did or did not move."""

    stance: Optional[Stance] = None
    stance_rejected_reason: Optional[str] = None
    affect: Optional[str] = None
    appraisal: Optional[str] = None
    register: Optional[str] = None
    speech_fragments: Optional[List[str]] = None
    disclosed: List[str] = field(default_factory=list)
    withheld: List[Tuple[str, str]] = field(default_factory=list)
    opened_threads: List[str] = field(default_factory=list)
    closed_threads: List[str] = field(default_factory=list)
    retrieve_cues: List[str] = field(default_factory=list)
    events: List[str] = field(default_factory=list)


def _rung(stance: str) -> int:
    try:
        return STANCE_ORDER.index(stance)  # type: ignore[arg-type]
    except ValueError:
        return -1


def decide_stance(
    memory: ClientWorkingMemory,
    proposed: Optional[str],
    event_kinds: set[str],
) -> Tuple[Optional[Stance], Optional[str]]:
    """Decide the stance. Returns (new_stance_or_None, rejection_reason).

    The rules, and each one exists because of something measured or named:

    - An unknown stance is discarded outright. A typo must not become a sixth
      rung, and a model asked for an enum will occasionally invent one.
    - **Regression is always permitted, immediately.** A client who feels judged
      closes up now, not in two turns.
    - **Advancing needs an earning event.** This is §4's contingency, and the
      direct answer to the 65.51/65.52 null: the actor currently responds to
      counsellor skill by talking more rather than by changing, so the thing that
      moves the client has to be something the counsellor did.
    - **Advancing moves one rung**, by CLAMPING rather than refusing. Guarded to
      reflecting on one good question is the fake-success failure in §1, but
      refusing the whole move over an oversized proposal froze the stance
      permanently in the first offline run — the direction was earned even when
      the distance was not.
    - **Advancing needs time in the current stance**, or the client oscillates.
    - **`reflecting` needs every thread closed.** The Zeigarnik block, and the
      structural version of "Thank you for today!" being false rather than
      discouraged.
    """
    if proposed is None:
        return None, None
    if proposed not in STANCE_ORDER:
        return None, f"unknown stance {proposed!r}"
    if proposed == memory.stance:
        return None, None

    here, there = _rung(memory.stance), _rung(proposed)

    if there < here:
        if "rupture" in event_kinds:
            return proposed, None  # type: ignore[return-value]
        # A regression with no rupture is still allowed, but only one rung: the
        # client drifting shut is plausible; collapsing to guarded is not.
        if here - there == 1:
            return proposed, None  # type: ignore[return-value]
        return None, "regression of more than one rung without a rupture"

    if not (event_kinds & ADVANCING_EVENTS):
        return None, "no advancing event — a stance is earned, not asserted"

    # CLAMP the magnitude rather than refuse the move. An advancing event was
    # observed, so the DIRECTION is earned; only the size of the step is the
    # model's invention, and discarding earned evidence because of an unearned
    # quantity is the wrong trade.
    #
    # This is not leniency, it is v2's `_apply` split applied properly: there,
    # scores came from rubric weights and never from the model. Here the
    # direction comes from code-verified events and the magnitude comes from
    # code. The proposed magnitude is simply not an input.
    #
    # Found by the first offline run, and it was not a subtle failure: the
    # updater proposed `engaged` from `guarded` on four of five turns — two
    # rungs, every time — so the old veto refused every advance and the stance
    # sat at `guarded` for the whole session. A ladder that can never be climbed
    # is decorative. The prompt now names the rungs and the adjacency rule too,
    # but a model will ignore that sometimes, and the machine has to be right
    # anyway.
    target: Stance = STANCE_ORDER[here + 1]
    clamped = target != proposed
    if clamped:
        logger.info(
            "[working-memory] clamping proposed advance %s -> %s down to %s "
            "(one rung per turn)",
            memory.stance,
            proposed,
            target,
        )

    # Every remaining gate applies to the CLAMPED target, so an overshooting
    # proposal cannot use the clamp to slip past them.
    if memory.turns_in_stance < MIN_TURNS_BEFORE_ADVANCE:
        return None, (
            f"only {memory.turns_in_stance} turn(s) in {memory.stance}; "
            f"{MIN_TURNS_BEFORE_ADVANCE} required before advancing"
        )
    if target == "reflecting" and memory.open_threads:
        return None, (
            f"{len(memory.open_threads)} thread(s) still open — reflecting is "
            "not reachable while the client is still carrying something"
        )
    return target, None


def _clean(values: List[str], *, limit: int, max_chars: int = 0) -> List[str]:
    out: List[str] = []
    for value in values:
        text = (value or "").strip()
        if not text:
            continue
        if max_chars:
            text = text[:max_chars]
        if text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def validate(proposal: ProposedUpdate, memory: ClientWorkingMemory) -> ValidatedUpdate:
    """Turn an advisory proposal into what code is willing to commit."""
    kinds = {
        e.kind.strip().lower() for e in proposal.events if e.kind and e.kind.strip()
    }
    unknown = kinds - CLIENT_EVENTS
    if unknown:
        logger.debug("[working-memory] discarding unknown events: %s", sorted(unknown))
    kinds &= CLIENT_EVENTS

    stance, reason = decide_stance(memory, proposal.stance, kinds)
    if reason:
        logger.info(
            "[working-memory] stance %s -> %s refused: %s",
            memory.stance,
            proposal.stance,
            reason,
        )

    # A withheld topic needs a deflection to be usable — the actor has to know
    # how to move away, not merely that it should. The two lists are paired
    # POSITIONALLY, so pairing has to happen on the RAW indices and cleaning
    # afterwards.
    #
    # Doing it the other way round was an off-by-one: `_clean` drops blanks and
    # duplicates, so a padded or repeated topic shifted every later deflection
    # up by one and the actor was handed the wrong excuse for the wrong subject.
    # ["the hospital visit", "", "her brother"] against three deflections gave
    # "her brother" the padding entry meant for the blank. That is worse than a
    # missing deflection: a nonsensical or mismatched excuse is a visible
    # character break, and the whole point of the ledger is that the actor
    # deflects convincingly.
    #
    # The fallback keeps a missing deflection usable rather than empty.
    raw_deflections = proposal.withheld_deflections
    withheld: List[Tuple[str, str]] = []
    seen_topics: List[str] = []
    for index, raw_topic in enumerate(proposal.withheld_topics):
        topic = (raw_topic or "").strip()
        if not topic or topic in seen_topics:
            continue
        seen_topics.append(topic)
        deflection = (
            raw_deflections[index].strip() if index < len(raw_deflections) else ""
        )
        withheld.append((topic, deflection or "change the subject naturally"))
        if len(withheld) >= 10:
            break

    return ValidatedUpdate(
        stance=stance,
        stance_rejected_reason=reason,
        affect=(proposal.affect or "").strip() or None,
        appraisal=(proposal.appraisal or "").strip() or None,
        register=(proposal.voice_register or "").strip() or None,
        speech_fragments=(
            _clean(
                proposal.speech_fragments,
                limit=MAX_FRAGMENTS,
                max_chars=MAX_FRAGMENT_CHARS,
            )
            or None
        ),
        disclosed=_clean(proposal.disclosed, limit=20),
        withheld=withheld,
        opened_threads=_clean(proposal.opened_threads, limit=10),
        closed_threads=_clean(proposal.closed_threads, limit=10),
        retrieve_cues=_clean(proposal.retrieve_cues, limit=8),
        events=sorted(kinds),
    )
