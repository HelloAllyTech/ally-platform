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
from typing import Any, List, Optional, Sequence, Tuple

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

#: A code-verified advancing event, synthesised from the turn's SCORE DELTA
#: rather than proposed by the updater.
#:
#: The stance ladder and the score-driven state machine were two independent
#: controllers of the same behaviour, and the ladder is the stricter one: a
#: counsellor could score their way into a warmer state band while the client
#: stayed guarded, because nothing the SCORE saw could earn a rung. That reads
#: from the outside as "the states stopped doing anything" — reported from prod
#: on scenario 440, where the score climbed 10 -> 104 across four configured
#: states and the ladder moved only on updater-proposed events.
#:
#: This is deliberately the strongest evidence in the set. Every other
#: advancing event is proposed by the updater LLM and then grounded against the
#: transcript; this one is computed in code from detector events carrying
#: scores the SCENARIO AUTHOR configured. It is also the only advancing event
#: that does not depend on the updater at all, which removes the single point
#: of failure the ladder has had since it shipped.
HELPFUL_BEHAVIOUR = "helpful_behaviour"

#: Events that can earn an advance. `repair` and `resistance_softened` are the
#: two the design names as advancing (§4); `disclosed` counts because revealing
#: something new IS the client opening up, not merely a bookkeeping event.
ADVANCING_EVENTS = frozenset(
    {"repair", "resistance_softened", "disclosed", HELPFUL_BEHAVIOUR}
)

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

#: Caps on every OTHER free-text field, which had none.
#:
#: MAX_FRAGMENT_CHARS existed for a stated reason — the model must not be able
#: to smuggle a whole reply in as "voice" — and that reason applies verbatim to
#: `affect`, `register` and each ledger entry, which were unbounded. This block
#: is rendered into EVERY turn's prompt, so an unbounded field is unbounded
#: prompt growth on a latency-critical path, and a 4,000-character "affect" is
#: an instruction the actor will follow.
#:
#: Sized against what the field is for rather than by guess: measured across the
#: offline runs, `affect` ran 8-31 characters, `register` 4-19, and disclosures
#: 15-80, so these are 3-5x the observed range — generous enough never to clip
#: real output, tight enough to bound the block.
MAX_STATE_FIELD_CHARS = 120
MAX_APPRAISAL_CHARS = 240
MAX_LEDGER_ITEM_CHARS = 200
MAX_TOPIC_CHARS = 120
MAX_CUE_CHARS = 60


def _capped(value: Optional[str], limit: int) -> Optional[str]:
    text = (value or "").strip()
    return text[:limit] if text else None


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


def _rung(stance: str, ladder: Sequence[str] = STANCE_ORDER) -> int:
    """Position on THIS session's ladder, or -1 if the stance is not on it.

    `ladder` defaults to the generic five so callers with no scenario states
    behave exactly as before.
    """
    try:
        return list(ladder).index(stance)
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
    ladder = tuple(memory.ladder or STANCE_ORDER)
    if proposed not in ladder:
        # Replaces what the `Stance` Literal used to catch, and catches more:
        # a stance from a DIFFERENT scenario's ladder is rejected here, which a
        # type covering one fixed vocabulary never could.
        return None, f"unknown stance {proposed!r}"
    if proposed == memory.stance:
        return None, None

    here, there = _rung(memory.stance, ladder), _rung(proposed, ladder)

    if there < here:
        if "rupture" in event_kinds:
            # Instant, and deliberately ungated: a client who feels judged
            # closes up NOW, and making them wait would be the same
            # uniform-responsiveness failure §1 measures.
            return proposed, None  # type: ignore[return-value]
        if here - there == 1:
            # A drift shut with no rupture must not happen on the turn straight
            # after arriving. Observed in the second v2v run: the ladder went
            # disclosing -> opening with no rupture, then the attempt back up was
            # refused for pacing — so an eventless drop cost nothing but took two
            # turns to undo, and the durable write-out recorded a bounce
            # (...opening, disclosing, opening, disclosing) that misrepresents
            # what happened. MIN_TURNS_BEFORE_ADVANCE guarded oscillation on the
            # way up only; this is the same guard on the way down, one turn
            # rather than two because retreating IS more responsive than opening.
            if memory.turns_in_stance < 1:
                return None, (
                    f"arrived in {memory.stance} this turn; an eventless drift "
                    "shut needs at least one turn there"
                )
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
    target: Stance = ladder[here + 1]
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
    # POSITIONAL, not by name. The rule is "the top of the ladder is not
    # reachable while the client is still carrying something"; it was written
    # as `== "reflecting"` only because the ladder was fixed. With a
    # scenario-defined ladder the top rung is whatever the author put last.
    if here + 1 == len(ladder) - 1 and memory.open_threads:
        return None, (
            f"{len(memory.open_threads)} thread(s) still open — {target} is "
            "not reachable while the client is still carrying something"
        )
    return target, None


def _clean(values: List[str], *, limit: int, max_chars: int = 0) -> List[str]:
    out: List[str] = []
    for value in values:
        text = (value or "").strip()
        if not text:
            continue
        if max_chars and len(text) > max_chars:
            # Cut at a word boundary. A mid-word cut leaves a fragment like
            # "ove" (seen in the second v2v run), and cue matching is
            # prefix-based, so that fragment silently matches every "over…"
            # word in the pool.
            text = text[:max_chars]
            if " " in text:
                text = text.rsplit(" ", 1)[0]
        if text not in out:
            out.append(text)
        if len(out) >= limit:
            break
    return out


def validate(
    proposal: ProposedUpdate,
    memory: ClientWorkingMemory,
    messages: Sequence[Any] = (),
    score_delta: int = 0,
    advancing_behaviours: Sequence[str] = (),
    authored_stance: Optional[str] = None,
) -> ValidatedUpdate:
    """Turn an advisory proposal into what code is willing to commit.

    `authored_stance` is the state the AUTHOR's score bands resolved to this
    turn. When supplied it is simply TAKEN: working memory no longer
    adjudicates progression, so `decide_stance` and its gates — earned advance,
    two-turn dwell, one rung per turn — are bypassed entirely and the stance
    becomes a label for where the author's state machine already is.

    Everything else here is unchanged, because that IS working memory's job:
    grounding events against the transcript, capping free text, validating the
    ledgers, choosing what to recall.

    `messages` is the turn window the proposal was derived from. Optional
    because `check_grounding` treats an absent transcript as "cannot check"
    rather than "invented" — a caller with no messages gets the previous
    behaviour, not a silently emptied update.

    `advancing_behaviours` are the ids of SHOULD_DO behaviour instructions the
    detector credited this turn. Preferred over `score_delta` because it is the
    behaviour ITSELF rather than a sum: a +9 from "Validate experience" and a
    +9 from "Follows appropriate reporting or referral procedures" are the same
    number and are not the same evidence. Carrying the ids is also what makes
    the relational-vs-procedural question answerable from logs later, instead
    of unanswerable as it is today.

    `score_delta` remains as the fallback for scenarios that score through
    events rather than behaviour instructions. It is this turn's change in the
    simulation score — the sum of
    the scores on the events the behaviour detector fired. A POSITIVE delta
    means the counsellor did something the scenario author scored as helpful,
    and that earns an advancing event in its own right.

    Only positive. A negative delta is NOT mirrored into a regression: the
    regression path has no minimum-dwell gate by design (a client who feels
    judged closes up immediately), so detector noise on the way down costs a
    rung instantly, where noise on the way up is still bounded by the one-rung
    clamp and the two-turn dwell. The asymmetry is the safeguard, not an
    oversight — `rupture` remains the only way down.
    """
    # An event without evidence cannot earn anything.
    #
    # The prompt demands a quoted span per event and this module's thesis is
    # that the proposal is untrusted — but nothing read `evidence`, so `kind`
    # alone was enough to advance a stance. The single strongest
    # anti-fabrication rule in the prompt was unenforced in the one place whose
    # job is enforcing it.
    #
    # Checked before turning this on, because enforcing it blindly would
    # re-freeze the stance the way the overshoot veto did: across three probe
    # conversations the updater populated evidence on 4 of 4 events, every one a
    # real span from the turns. So this rejects fabrication rather than normal
    # output.
    # Second gate: the evidence must actually be IN the transcript.
    #
    # Requiring a quoted span stops an event with nothing to point at. It does
    # not stop an event pointing at something the client never said — the
    # updater writes `evidence` as free text, so a confabulated quote passes
    # the presence check unchanged, advances the stance, and then shapes every
    # subsequent prompt.
    #
    # `check_grounding` already answers exactly this question and is already
    # trusted for it: the write-out runs it over the whole ledger at session
    # end. Running it at COMMIT closes the loop from "caught after the session,
    # too late to matter" to "caught before it reaches a prompt". Same lexical
    # overlap test, no LLM, and it runs in the detached updater path so it
    # costs no turn latency.
    #
    # Ungrounded events are PROVISIONAL, not deleted: they simply do not earn a
    # stance transition. Everything else the proposal carries — affect,
    # register, fragments, disclosures — is untouched, and disclosures keep
    # their own grounding pass at write-out. That asymmetry is deliberate and
    # follows 238dd0c's lesson: prod quarantines 1-8 items per session against
    # 13-15 verified, so a strict delete here would throw away real events at
    # that rate. A stance is the one thing worth being strict about, because it
    # is the only field that persists and biases the NEXT update.
    from app.core.working_memory.writeout import check_grounding

    evidenced: List[tuple[str, str]] = []
    for event in proposal.events:
        kind = (event.kind or "").strip().lower()
        if not kind:
            continue
        evidence = (event.evidence or "").strip()
        if not evidence:
            logger.info(
                "[working-memory] discarding unevidenced event %r — a claim "
                "with nothing to quote cannot earn a transition",
                kind,
            )
            continue
        evidenced.append((kind, evidence))

    grounded_texts, ungrounded_texts = check_grounding(
        [evidence for _, evidence in evidenced], messages
    )
    grounded_set = set(grounded_texts)

    kinds = set()
    if advancing_behaviours:
        kinds.add(HELPFUL_BEHAVIOUR)
        logger.info(
            "[working-memory] %d SHOULD_DO behaviour(s) earn an advancing " "event: %s",
            len(advancing_behaviours),
            ", ".join(str(b) for b in advancing_behaviours),
        )
    elif score_delta > 0:
        # NOT routed through the grounding gate below, and that is the point:
        # grounding exists to check text the updater invented. This event was
        # not proposed by any model — it is arithmetic over detector events —
        # so there is no quote to verify and nothing to confabulate.
        kinds.add(HELPFUL_BEHAVIOUR)
        logger.info(
            "[working-memory] score delta %+d earns an advancing event", score_delta
        )
    for kind, evidence in evidenced:
        if evidence not in grounded_set:
            logger.info(
                "[working-memory] event %r is PROVISIONAL — its evidence is not "
                "in the transcript, so it cannot earn a stance transition: %r",
                kind,
                evidence[:80],
            )
            continue
        kinds.add(kind)
    if ungrounded_texts:
        logger.info(
            "[working-memory] %d of %d evidenced event(s) were ungrounded",
            len(ungrounded_texts),
            len(evidenced),
        )
    unknown = kinds - CLIENT_EVENTS
    if unknown:
        logger.debug("[working-memory] discarding unknown events: %s", sorted(unknown))
    kinds &= CLIENT_EVENTS

    if authored_stance is not None:
        # The author's flow decides; nothing here may refuse, clamp or delay it.
        stance = authored_stance if authored_stance != memory.stance else None
        reason = None
    else:
        # No authored state resolved — a scenario with no states. The generic
        # ladder still governs itself, because there is nothing else to follow.
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
        withheld.append(
            (
                topic[:MAX_TOPIC_CHARS],
                (deflection or "change the subject naturally")[:MAX_LEDGER_ITEM_CHARS],
            )
        )
        if len(withheld) >= 10:
            break

    return ValidatedUpdate(
        stance=stance,
        stance_rejected_reason=reason,
        affect=_capped(proposal.affect, MAX_STATE_FIELD_CHARS),
        appraisal=_capped(proposal.appraisal, MAX_APPRAISAL_CHARS),
        register=_capped(proposal.voice_register, MAX_STATE_FIELD_CHARS),
        speech_fragments=(
            _clean(
                proposal.speech_fragments,
                limit=MAX_FRAGMENTS,
                max_chars=MAX_FRAGMENT_CHARS,
            )
            or None
        ),
        disclosed=_clean(proposal.disclosed, limit=20, max_chars=MAX_LEDGER_ITEM_CHARS),
        withheld=withheld,
        opened_threads=_clean(
            proposal.opened_threads, limit=10, max_chars=MAX_TOPIC_CHARS
        ),
        closed_threads=_clean(
            proposal.closed_threads, limit=10, max_chars=MAX_TOPIC_CHARS
        ),
        retrieve_cues=_clean(proposal.retrieve_cues, limit=8, max_chars=MAX_CUE_CHARS),
        events=sorted(kinds),
    )
