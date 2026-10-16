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

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.core.livekit.delivery import ProposedDelivery
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


class ProposedUpdate(BaseModel):
    """The updater's structured output. Untrusted; see ``validate``."""

    #: `populate_by_name` so the alias below is not the ONLY accepted spelling.
    #: A model that answers with the attribute name instead of the alias is
    #: still parsed rather than silently dropped to None — the failure mode
    #: this whole module exists to prevent, one layer down.
    model_config = ConfigDict(populate_by_name=True)

    #: No `events` and no `stance`. The updater reports what the client's
    #: inner state IS; where the client is in the conversation is the author's
    #: states, resolved from the simulation score, and taken verbatim.
    affect: Optional[str] = None
    appraisal: Optional[str] = None
    #: One name on the wire, a different one in Python, and both deliberate.
    #:
    #: The MODEL is asked for `register`, because that is what every other
    #: layer a human reads calls it: the store's field, the `"register"` key
    #: in the monologue payload, and the `{working_memory_register}` section
    #: the actor prompt renders. The updater prompt and the main-agent prompt
    #: naming the same thing differently was a real complaint from people
    #: curating both, and the prompt text is where it was felt.
    #:
    #: The ATTRIBUTE stays `voice_register`, because a field literally named
    #: `register` shadows an attribute on pydantic's ``BaseModel`` — it loads,
    #: but it warns, and a field that quietly collides with framework
    #: internals is not worth the tidier spelling. The alias buys the shared
    #: name without the collision, and puts both spellings on one line where
    #: a reader sees the link instead of having to find it.
    voice_register: Optional[str] = Field(default=None, alias="register")
    speech_fragments: List[str] = Field(default_factory=list)
    disclosed: List[str] = Field(default_factory=list)
    withheld_topics: List[str] = Field(default_factory=list)
    withheld_deflections: List[str] = Field(default_factory=list)
    opened_threads: List[str] = Field(default_factory=list)
    closed_threads: List[str] = Field(default_factory=list)
    retrieve_cues: List[str] = Field(default_factory=list)
    #: How the client should START its next reply — the filler and the
    #: interim the learner hears first. Proposed here because this call already
    #: knows the client's state; validated against the session's opener catalog
    #: by the caller, which has it (see app/core/livekit/delivery.py).
    #:
    #: Required in the JSON schema (no default), so structured output always
    #: emits it: optional, gpt-4o-mini left it out of Hindi updates (prod V2V
    #: 2026-10-16, two sessions with no plan on any turn), the same failure the
    #: bridge line had before it was made required. The before-validator still
    #: tolerates an omission, so a model that skips it can't fail the update.
    delivery: Optional[ProposedDelivery] = Field(
        description=(
            "How the client starts the next reply: the filler and the interim. "
            "Always fill it in."
        ),
    )

    @model_validator(mode="before")
    @classmethod
    def _tolerate_missing_delivery(cls, data):
        if isinstance(data, dict) and "delivery" not in data:
            return {**data, "delivery": None}
        return data


@dataclass
class ValidatedUpdate:
    """What code decided to commit, and why the stance did or did not move."""

    #: Mirrors the author's resolved state. Never proposed, never refused.
    stance: Optional[Stance] = None
    affect: Optional[str] = None
    appraisal: Optional[str] = None
    register: Optional[str] = None
    speech_fragments: Optional[List[str]] = None
    disclosed: List[str] = field(default_factory=list)
    withheld: List[Tuple[str, str]] = field(default_factory=list)
    opened_threads: List[str] = field(default_factory=list)
    closed_threads: List[str] = field(default_factory=list)
    retrieve_cues: List[str] = field(default_factory=list)
    #: Passed through untouched: it is checked against the opener catalog,
    #: which lives with the worker, not here.
    delivery: Optional[ProposedDelivery] = None


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
    authored_stance: Optional[str] = None,
) -> ValidatedUpdate:
    """Turn an advisory proposal into what code is willing to commit.

    `authored_stance` is the state the AUTHOR's score bands resolved to this
    turn, and it is simply TAKEN. Working memory does not adjudicate
    progression: there is no ladder, no earned advance, no dwell gate and no
    rung clamp, because where the client is in the conversation is the
    scenario's decision and the stance is a label for it.

    What remains IS working memory's job: capping free text, pairing and
    validating the ledgers, and choosing what to recall.

    `messages` is the turn window the proposal was derived from. It is no
    longer used to ground events — the updater reports none — but stays in the
    signature because the ledger's own grounding pass runs at write-out over
    the same window, and a caller that already has it should not have to
    rediscover it later.

    Removed with the ladder: `score_delta` and `advancing_behaviours`. Both
    existed only to derive `helpful_behaviour`, the one advancing event the
    code computed rather than the model proposing, and an advancing event with
    nothing to advance is not a thing.
    """
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
    stance = (
        authored_stance
        if authored_stance is not None and authored_stance != memory.stance
        else None
    )
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
        delivery=proposal.delivery,
    )
