"""The delivery plan: how the character should START its next reply.

WHY THIS EXISTS
---------------
What the learner hears first on a turn — a hum, a breath, a few holding words,
or simply the reply after a pause — is a judgement about the CHARACTER's state:
a guarded client hesitates ("um…"), a reflective one hums ("hmm…"), and a moment
of weight is better met with silence. Client working memory already derives that
state every turn, off the reply path. So instead of a separate filler generator
guessing the mood from the persona description, the updater that already knows
the mood proposes the plan, and the worker plays it.

Three parts, in the codebase's "the LLM proposes, code disposes" shape:

* ``ProposedDelivery`` — the structured output a model returns. Untrusted.
* ``validate_delivery`` — code decides what survives: unknown catalog ids are
  dropped, the interim pieces are capped and safety-checked.
* ``TurnDelivery`` — the per-session holder shared by the worker (which reads
  the plan and records the opener it played) and the graph (which writes plans
  and tells the reply what was already said). Worker-owned and passed in through
  ``configurable``, exactly like the working-memory store.

The plan is made AFTER the character speaks and used on the NEXT turn, so it can
fit the character's state but not what the learner is about to say. That is the
deliberate trade: nothing is added between the learner finishing and hearing
audio.

Only working-memory scenarios get a plan. The rest keep ``DEFAULT_PLAN`` — a
filler or a pause, never an interim — because a second planner prompt for the
same job confused the people editing the prompts.
"""

from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Set

from pydantic import BaseModel, Field, model_validator

from app.core.livekit.opener_catalog import OPENER_KINDS, SessionCatalog
from app.core.logger import get_logger

logger = get_logger(__name__)

#: The interim is a few short pieces the character says in order while it
#: gathers its thoughts ("It's just that…" · "I don't know…"), each recorded
#: separately so the worker can stop after any of them. A piece stays short: a
#: long one turns into a reply, which the interim must never be — the real reply
#: follows and must not be contradicted, and in prod a sentence-length interim
#: made learners answer it and cut off the real reply.
MAX_INTERIM_PIECES = 3
MAX_PIECE_WORDS = 8
MAX_PIECE_CHARS = 60
MAX_OPENER_IDS = 3

#: Opener kinds the plan may name, plus the explicit choice of saying nothing.
PLAN_KINDS = ("silence",) + OPENER_KINDS

#: The closest vocal kind to a body sound the session cannot play.
_NEAREST_KIND = {"sigh": "reflective", "breath": "hesitation"}


class ProposedDelivery(BaseModel):
    """How the character should begin its NEXT reply. Untrusted model output."""

    opener_kind: str = Field(
        default="hum",
        description=(
            "The kind of first sound that fits the character's state right now: "
            "silence, hum, hesitation, reflective, lexical, breath or sigh."
        ),
    )
    opener_ids: List[str] = Field(
        default_factory=list,
        description="Up to 3 opener ids from the catalog, best fit first.",
    )
    # Required in the JSON schema (no default), so structured output always
    # emits it: with the field optional, the working-memory updater left the
    # line it replaced out of 4 of 5 plans in a v2v run even with the prompt
    # saying "required". The before-validator below still tolerates an
    # omission, so a model that skips it can't fail the whole proposal.
    interim: List[str] = Field(
        description=(
            "1-3 very short pieces (2-6 words each) the character says in order "
            "while gathering its thoughts, each still making sense if it stops "
            "there. Holding the moment: no answer, fact, decision or question."
        ),
    )
    hold_silence: bool = Field(
        default=False,
        description="True when a noticeable pause fits better than any sound.",
    )

    @model_validator(mode="before")
    @classmethod
    def _tolerate_missing_interim(cls, data):
        if isinstance(data, dict):
            interim = data.get("interim")
            if interim is None:
                interim = []
            elif isinstance(interim, str):
                interim = [interim]
            return {**data, "interim": interim}
        return data


@dataclass(frozen=True)
class DeliveryPlan:
    """What code accepted from a proposal."""

    opener_kind: str = "hum"
    opener_ids: tuple = ()
    #: The interim, in speaking order. Empty = fillers and pauses only.
    interim: tuple = ()
    hold_silence: bool = False
    #: Which planner produced it: "working_memory" | "default".
    source: str = "default"
    #: The character turn the plan was derived from; -1 when unknown.
    made_after_turn: int = -1
    created_at: float = field(default_factory=time.time)


#: Used until any planner has produced something. Neutral on purpose: it must be
#: safe for a character in any state on the first learner turn.
DEFAULT_PLAN = DeliveryPlan(opener_kind="hum", source="default")


def _safe_piece(text: Optional[str]) -> Optional[str]:
    """An interim piece that can precede any reply, or None.

    Same rules as the filler safety check, sized for a phrase: no question (it
    would demand an answer the character hasn't given), no digits (always a
    specific claim), nothing long enough to be a reply in its own right.
    """
    line = " ".join((text or "").split())
    if not line:
        return None
    if len(line) > MAX_PIECE_CHARS or len(line.split()) > MAX_PIECE_WORDS:
        return None
    if "?" in line or "？" in line:
        return None
    if any(ch.isdigit() for ch in line):
        return None
    return line


def _words(text: str) -> List[str]:
    from app.core.working_memory.text import word_list

    return word_list(text)


def _bigrams(words: Sequence[str]) -> Set[tuple]:
    return set(zip(words, words[1:]))


def repeats_recent_line(piece: Optional[str], recent_lines: Sequence[str]) -> bool:
    """Whether ``piece`` restates something the character said recently.

    In the first prod day a holding line was the character's reply from two
    turns earlier, word for word, which sounds like a replay rather than a person
    holding the moment. Contained verbatim, or 80% of its word PAIRS already in
    one recent line, counts as a repeat.

    Pairs, not single words: a short line in any language shares most of its
    function words ("है", "में", "मुझे", "it's", "a") with whatever came
    before. With single words, and a ``\\w+`` tokenizer that split Devanagari
    at its vowel signs, a Hindi v2v run dropped 5 of 5 holding lines, including
    "सोचने में समय लगता है" that the character had never said.
    """
    words = _words(piece or "")
    if len(words) < 3:
        return False
    phrase = " ".join(words)
    grams = _bigrams(words)
    for line in recent_lines or ():
        line_words = _words(line)
        if not line_words:
            continue
        if phrase in " ".join(line_words):
            return True
        if len(grams & _bigrams(line_words)) / len(grams) >= 0.8:
            return True
    return False


def validate_delivery(
    proposal: Optional[ProposedDelivery],
    catalog: Optional[SessionCatalog],
    *,
    source: str,
    made_after_turn: int = -1,
    recent_lines: Sequence[str] = (),
) -> Optional[DeliveryPlan]:
    """Turn a proposal into a plan, or None when nothing usable came back.

    Opener ids the session's catalog does not hold are dropped rather than
    guessed at — a hallucinated id is the common failure. A kind outside the
    vocabulary falls back to the kind of the first surviving id, else "hum".
    """
    if proposal is None:
        return None
    ids: List[str] = []
    for raw in proposal.opener_ids or []:
        entry_id = str(raw or "").strip()
        if not entry_id or entry_id in ids:
            continue
        if catalog is not None and catalog.get(entry_id) is None:
            continue
        ids.append(entry_id)
        if len(ids) >= MAX_OPENER_IDS:
            break
    kind = str(proposal.opener_kind or "").strip().lower()
    first = catalog.get(ids[0]) if (catalog is not None and ids) else None
    if kind not in PLAN_KINDS:
        kind = first.kind if first is not None else "hum"
    elif catalog is not None and kind != "silence" and not catalog.ids_of_kind(kind):
        # The session cannot play this kind (e.g. "sigh" before any sigh audio
        # ships). Keep the intent, not the label: in the first live run the
        # updater asked for "sigh" on most turns, and treating an unplayable
        # kind as "no sound fits" left 10 of 13 turns silent.
        kind = first.kind if first is not None else _NEAREST_KIND.get(kind, "hum")
    interim = _validate_interim(proposal.interim, recent_lines)
    return DeliveryPlan(
        opener_kind=kind,
        opener_ids=tuple(ids),
        interim=interim,
        hold_silence=bool(proposal.hold_silence) or kind == "silence",
        source=source,
        made_after_turn=made_after_turn,
    )


def _validate_interim(pieces: Sequence[str], recent_lines: Sequence[str]) -> tuple:
    """The pieces that survive, in order.

    A piece that replays a recent line is skipped and the rest are kept: ending
    the interim at the first failure threw away every interim whose opening
    repeated (prod V2V 2026-10-16: the updater wrote "It's just that…" nearly
    every turn, and Hindi openings were often a line the client had just said),
    so almost none played. Each piece already has to stand on its own, because
    the reply can start after any of them.
    """
    from app.core.livekit.reply_shaping import (
        strip_leading_hesitation,
        strip_understanding_claim,
    )

    kept: List[str] = []
    for raw in list(pieces or [])[:MAX_INTERIM_PIECES]:
        if not kept:
            # The opening piece follows a filler more often than not, so a
            # leading "Um," is a second hesitation in a row; and "I see…" in
            # front of a reply that pushes back contradicts it in one breath
            # (both heard in prod from the interim this replaces).
            raw = strip_understanding_claim(strip_leading_hesitation(raw or ""))
            if not raw.strip():
                continue
        if repeats_recent_line(raw, recent_lines):
            dropped = "repeats a recent line"
        elif _safe_piece(raw) is None:
            dropped = "unsafe or too long" if (raw or "").strip() else None
        else:
            kept.append(_safe_piece(raw))
            continue
        if dropped:
            # Logged because a short interim is otherwise indistinguishable
            # from a planner that wrote a short one.
            logger.info("[DELIVERY] interim piece dropped (%s): %r", dropped, raw)
    return tuple(kept)


@dataclass
class OpenerRecord:
    """What the worker decided to play at the start of the current turn."""

    #: "none" | "vocal" | "body" — body = breath or sigh.
    category: str
    entry_id: Optional[str] = None
    kind: Optional[str] = None
    #: The filler's words, when it has any ("Hmm…"; a breath has none).
    spoken: Optional[str] = None
    #: The interim pieces scheduled to follow, in order. The reply may cut in
    #: after any of them.
    interim: tuple = ()
    decided_at: float = field(default_factory=time.time)

    @property
    def made_a_sound(self) -> bool:
        return self.category != "none" or bool(self.interim)


class TurnDelivery:
    """Per-session holder: the latest plan, and this turn's opener.

    Single event loop, so plain attributes suffice: plans are written from the
    detached working-memory update and read by the worker's state handlers, all
    on the session's loop.
    """

    def __init__(self, catalog: Optional[SessionCatalog] = None) -> None:
        self.catalog = catalog
        self._plan: DeliveryPlan = DEFAULT_PLAN
        self._opener: Optional[OpenerRecord] = None
        self._listeners: List[Callable[[DeliveryPlan], None]] = []
        self.plans_received = 0
        #: Set by the worker once openers can actually play (clips rendered,
        #: handlers wired). The updater proposes no plan until then, so a
        #: session whose delivery layer never comes up writes no interim.
        self.active = False

    # ---- plans (written by the graph's planners) --------------------

    @property
    def plan(self) -> DeliveryPlan:
        return self._plan

    def on_plan(self, listener: Callable[[DeliveryPlan], None]) -> None:
        """Call ``listener`` with every accepted plan (e.g. to render its interim)."""
        self._listeners.append(listener)

    def set_plan(self, plan: Optional[DeliveryPlan]) -> None:
        if plan is None:
            return
        self._plan = plan
        self.plans_received += 1
        logger.info(
            "[DELIVERY] plan from %s after turn %d: kind=%s ids=%s hold=%s interim=%d",
            plan.source,
            plan.made_after_turn,
            plan.opener_kind,
            ",".join(plan.opener_ids) or "-",
            plan.hold_silence,
            len(plan.interim),
        )
        for listener in list(self._listeners):
            try:
                listener(plan)
            except Exception:  # noqa: BLE001 - a listener must not drop the plan
                logger.warning("[DELIVERY] plan listener failed", exc_info=True)

    # ---- this turn's opener (written by the worker) -----------------

    def begin_turn(self) -> None:
        """Forget last turn's opener; called when the agent starts thinking."""
        self._opener = None

    def note_opener(self, record: OpenerRecord) -> None:
        self._opener = record

    def end_turn(self) -> None:
        self._opener = None

    @property
    def opener(self) -> Optional[OpenerRecord]:
        return self._opener

    def reply_note(self) -> Optional[str]:
        """One line for the reply prompt describing what was already said.

        This is what a separate filler system could never do: the opener is
        decided from a plan that existed before the turn began, so the actor
        can be told about it and stop opening with a second hesitation — 19 of
        43 sampled prod turns were exactly that double "umm…" -> "[long pause]
        Yeah…".

        The filler is named by kind, never quoted: the first version said 'You
        have already begun with "Uh…"', and the model continued by restating it
        ("I mean…" -> "I mean, I try…"). The interim IS quoted: it is words the
        reply has to carry on from, and a reply that never learned them started
        a fresh thought after "It's just that…" — the disconnect learners
        reported. The trimmer (``_trim_after_opener``) removes a restatement.
        """
        record = self._opener
        if record is None or not record.made_a_sound:
            return None
        rules = (
            "Begin directly with what you actually want to say: no opening "
            "hesitation, filler word, sigh or pause tag."
        )
        sound = None
        if record.category == "body" and record.kind:
            sound = f"a {record.kind}"
        elif record.category != "none":
            sound = "a brief thinking sound"
        if not record.interim:
            return (
                f"Before this reply, the listener already heard you make {sound}, "
                f"then pause. {rules[:-1]}, and do not repeat or refer to that sound."
            )
        said = " … ".join(f'"{piece}"' for piece in record.interim)
        lead = f"you make {sound}, then " if sound else ""
        return (
            f"Before this reply, the listener heard {lead}you start to say, in "
            f"order: {said} (they may have heard only the first of these). Your "
            "reply continues straight on from them as one thought: do not repeat "
            f"or restate them. {rules}"
        )
