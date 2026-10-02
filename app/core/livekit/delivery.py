"""The delivery plan: how the character should START its next reply.

WHY THIS EXISTS
---------------
What the learner hears first on a turn — a hum, a breath, a short bridging line,
or simply the reply after a pause — is a judgement about the CHARACTER's state:
a guarded client hesitates ("um…"), a reflective one hums ("hmm…"), and a moment
of weight is better met with silence. Client working memory already derives that
state every turn, off the reply path. So instead of a separate filler generator
guessing the mood from the persona description, the updater that already knows
the mood proposes the plan, and the worker plays it.

Three parts, in the codebase's "the LLM proposes, code disposes" shape:

* ``ProposedDelivery`` — the structured output a model returns. Untrusted.
* ``validate_delivery`` — code decides what survives: unknown catalog ids are
  dropped, the bridge line is capped and safety-checked.
* ``TurnDelivery`` — the per-session holder shared by the worker (which reads
  the plan and records the opener it played) and the graph (which writes plans
  and tells the reply what was already said). Worker-owned and passed in through
  ``configurable``, exactly like the working-memory store.

The plan is made AFTER the character speaks and used on the NEXT turn, so it can
fit the character's state but not what the learner is about to say. That is the
deliberate trade: nothing is added between the learner finishing and hearing
audio.
"""

from __future__ import annotations

import asyncio
import re
import time
from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Set

from pydantic import BaseModel, Field, model_validator

from app.core.livekit.opener_catalog import OPENER_KINDS, SessionCatalog
from app.core.logger import get_logger

logger = get_logger(__name__)

#: A bridge line is one short sentence. Longer and it becomes a reply, which it
#: must never be: the real reply follows and must not be contradicted. It must
#: also fit the wait: after an opener and two thinking beats, a ~4 s gap leaves
#: about 1.7 s, so a 15-word (~3 s) line never fit and was never played.
MAX_BRIDGE_WORDS = 10
MAX_BRIDGE_CHARS = 90
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
    # emits it: with the field optional, the working-memory updater left it
    # out of 4 of 5 plans in a v2v run even with the prompt saying
    # "required". The before-validator below still tolerates an omission, so
    # a model that skips it can't fail the whole working-memory proposal.
    bridge_line: Optional[str] = Field(
        description=(
            "Required: a 3-8 word non-committal line in the character's voice "
            "that could precede ANY reply (no answer, no fact, no question)."
        ),
    )
    hold_silence: bool = Field(
        default=False,
        description="True when a noticeable pause fits better than any sound.",
    )

    @model_validator(mode="before")
    @classmethod
    def _tolerate_missing_bridge(cls, data):
        if isinstance(data, dict) and "bridge_line" not in data:
            return {**data, "bridge_line": None}
        return data


@dataclass(frozen=True)
class DeliveryPlan:
    """What code accepted from a proposal."""

    opener_kind: str = "hum"
    opener_ids: tuple = ()
    bridge_line: Optional[str] = None
    hold_silence: bool = False
    #: Which planner produced it: "working_memory" | "planner" | "default".
    source: str = "default"
    #: The character turn the plan was derived from; -1 when unknown.
    made_after_turn: int = -1
    created_at: float = field(default_factory=time.time)


#: Used until any planner has produced something. Neutral on purpose: it must be
#: safe for a character in any state on the first learner turn.
DEFAULT_PLAN = DeliveryPlan(opener_kind="hum", source="default")


def _safe_bridge(text: Optional[str]) -> Optional[str]:
    """A bridge line that can precede any reply, or None.

    Same rules as the filler safety check, sized for a sentence: no question
    (it would demand an answer the character hasn't given), no digits (always a
    specific claim), nothing long enough to be a reply in its own right.
    """
    line = " ".join((text or "").split())
    if not line:
        return None
    if len(line) > MAX_BRIDGE_CHARS or len(line.split()) > MAX_BRIDGE_WORDS:
        return None
    if "?" in line or "？" in line:
        return None
    if any(ch.isdigit() for ch in line):
        return None
    return line


def _words(text: str) -> List[str]:
    return re.findall(r"\w+", (text or "").lower())


def repeats_recent_line(bridge: Optional[str], recent_lines: Sequence[str]) -> bool:
    """Whether ``bridge`` restates something the character said recently.

    In the first prod day a bridge line was the character's reply from two turns
    earlier, word for word, which sounds like a replay rather than a person
    holding the moment. Contained verbatim, or 80% of its words already in one
    recent line, counts as a repeat.
    """
    words = _words(bridge or "")
    if len(words) < 3:
        return False
    phrase = " ".join(words)
    for line in recent_lines or ():
        line_words = _words(line)
        if not line_words:
            continue
        if phrase in " ".join(line_words):
            return True
        overlap = sum(1 for w in words if w in set(line_words)) / len(words)
        if overlap >= 0.8:
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
    raw_bridge = proposal.bridge_line
    if repeats_recent_line(raw_bridge, recent_lines):
        bridge, dropped = None, "repeats a recent line"
    else:
        bridge = _safe_bridge(raw_bridge)
        dropped = "unsafe or too long" if raw_bridge and not bridge else None
    if dropped:
        # Logged because a missing bridge is otherwise indistinguishable from
        # a planner that never wrote one.
        logger.info("[DELIVERY] bridge dropped (%s): %r", dropped, raw_bridge)
    return DeliveryPlan(
        opener_kind=kind,
        opener_ids=tuple(ids),
        bridge_line=bridge,
        hold_silence=bool(proposal.hold_silence) or kind == "silence",
        source=source,
        made_after_turn=made_after_turn,
    )


@dataclass
class OpenerRecord:
    """What the worker decided to play at the start of the current turn."""

    #: "none" | "vocal" | "body" — body = breath or sigh.
    category: str
    entry_id: Optional[str] = None
    kind: Optional[str] = None
    #: The words spoken, when there were any (catalog text or bridge line).
    spoken: Optional[str] = None
    bridge: Optional[str] = None
    decided_at: float = field(default_factory=time.time)

    @property
    def made_a_sound(self) -> bool:
        return self.category != "none" or bool(self.bridge)


class TurnDelivery:
    """Per-session holder: the latest plan, and this turn's opener.

    Single event loop, so plain attributes suffice: plans are written from the
    detached planner tasks and read by the worker's state handlers, all on the
    session's loop.
    """

    def __init__(self, catalog: Optional[SessionCatalog] = None) -> None:
        self.catalog = catalog
        self._plan: DeliveryPlan = DEFAULT_PLAN
        self._opener: Optional[OpenerRecord] = None
        self._listeners: List[Callable[[DeliveryPlan], None]] = []
        self.plans_received = 0
        #: Set by the worker once openers can actually play (clips rendered,
        #: handlers wired). Planners no-op until then, so a session whose
        #: delivery layer never comes up pays for no planning calls.
        self.active = False
        #: The small planner (non-working-memory scenarios) runs one call at a
        #: time; strong references to its detached tasks live here.
        self.planner_in_flight = False
        self.tasks: Set[asyncio.Task] = set()

    # ---- plans (written by the graph's planners) --------------------

    @property
    def plan(self) -> DeliveryPlan:
        return self._plan

    def on_plan(self, listener: Callable[[DeliveryPlan], None]) -> None:
        """Call ``listener`` with every accepted plan (e.g. to pre-render a bridge)."""
        self._listeners.append(listener)

    def set_plan(self, plan: Optional[DeliveryPlan]) -> None:
        if plan is None:
            return
        self._plan = plan
        self.plans_received += 1
        logger.info(
            "[DELIVERY] plan from %s after turn %d: kind=%s ids=%s hold=%s bridge=%s",
            plan.source,
            plan.made_after_turn,
            plan.opener_kind,
            ",".join(plan.opener_ids) or "-",
            plan.hold_silence,
            bool(plan.bridge_line),
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
        """
        record = self._opener
        if record is None or not record.made_a_sound:
            return None
        # Deliberately NOT quoting the sound. The first version said 'You have
        # already begun with "Uh…"', and in the first live run the model
        # continued by restating it: "I mean…" -> "I mean, I try…", and one
        # reply was only "Uh…". Naming the kind of sound, never its words,
        # gives the model nothing to echo.
        if record.category == "body" and record.kind:
            sound = f"a {record.kind}"
        elif record.bridge and record.category == "none":
            sound = "a short holding line"
        else:
            sound = "a brief thinking sound"
        if record.bridge and record.category != "none":
            sound += " and a short holding line"
        return (
            f"Before this reply, the listener already heard you make {sound}, "
            "then pause. Begin directly with what you actually want to say: no "
            "opening hesitation, filler word, sigh or pause tag, and do not "
            "repeat or refer to that sound."
        )
