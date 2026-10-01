"""Turn-time rules for what the learner hears first. Deterministic, no LLM.

The delivery plan (``delivery.py``) says what FITS the character; this module
decides what actually PLAYS on a given turn, applying the product rubric for
natural-sounding replies:

* **Not every turn starts with a sound.** The first thing heard varies across
  turns: nothing (just the reply after a pause), a vocal opener, a breath or
  sigh, a bridging line. The same category is discouraged twice in a row and
  vocal openers are capped at ``max_vocal_run`` turns in a row. Prod had
  filler-first turns in 55% of turns per session and runs of up to 11.
* **One opener at most, then a pause.** Never two fillers back to back (67% of
  prod filler turns stacked two). A bridge line, when one plays, comes after a
  thinking pause, not glued to the opener.
* **The gap varies.** A randomised hold before the opener, longer when the plan
  says a pause fits, so the agent is not a metronome at ~630 ms.
* **Never the same sound turn after turn.** A no-repeat window over catalog
  FAMILIES (hmm / hmmm / hmm… are one family).
* **Nothing over the learner.** Declines when the learner's last words read as
  unfinished (they are likely to continue), and the runner cancels on any
  learner speech during the hold. In prod ~30% of fillers started while the
  learner was still mid-turn.
* **Nothing before a goodbye**, and nothing on a turn predicted to be fast.

The policy is pure — state in, decision out — so every rule is testable without
a room, a TTS or a clock.
"""

from __future__ import annotations

import random
import re
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Sequence

from app.core.livekit.delivery import DeliveryPlan
from app.core.livekit.opener_catalog import (
    BODY_KINDS,
    VOCAL_KINDS,
    CatalogEntry,
    SessionCatalog,
)

#: Words a speaker trails off on when they have NOT finished: a turn that ends
#: on one is likely to continue, so an opener would land on top of the rest.
#: Lower-case, compared after stripping punctuation. Deliberately short: only
#: words that cannot plausibly end a finished sentence.
_UNFINISHED_ENDINGS = frozenset(
    {
        # en ("so", "that", "then", "like" are left out: "I think so." and
        # "I'd like that." are finished sentences)
        "and",
        "but",
        "because",
        "or",
        "if",
        "which",
        "the",
        "a",
        "an",
        "to",
        "of",
        "with",
        "um",
        "uh",
        "when",
        # hi
        "और",
        "लेकिन",
        "क्योंकि",
        "कि",
        "या",
        "अगर",
        "जो",
        # mr ("की" is left out: it also ends a question)
        "आणि",
        "पण",
        "कारण",
        "म्हणून",
        "जर",
        "किंवा",
    }
)

#: A learner line that is a leave-taking. A filler in front of "Bye." is the
#: one short-answer case prod shows (0.9% of replies, nearly all goodbyes).
_FAREWELL = re.compile(
    r"\b(bye|goodbye|good night|see you|take care|thank you so much|"
    r"that'?s all)\b|अलविदा|फिर मिलेंगे|धन्यवाद|नमस्ते|बाय|भेटू",
    re.IGNORECASE,
)


def learner_seems_unfinished(text: Optional[str]) -> bool:
    """Whether the learner's last line reads as cut off mid-thought."""
    line = (text or "").strip()
    if not line:
        return False
    if line.endswith((",", "…", "...", "-", "—", ";", ":")):
        return True
    last = re.split(r"\s+", line)[-1].strip(".,!?।\"'").lower()
    return last in _UNFINISHED_ENDINGS


def learner_is_leaving(text: Optional[str]) -> bool:
    return bool(_FAREWELL.search(text or ""))


@dataclass(frozen=True)
class OpenerDecision:
    """What to play before the reply this turn."""

    #: "none" | "vocal" | "body"
    category: str
    entry: Optional[CatalogEntry] = None
    #: Silence before the opener starts, in ms.
    hold_ms: float = 0.0
    #: Whether the pre-rendered bridge line follows the opener (after a pause).
    bridge: bool = False
    #: Why — recorded on the turn metrics.
    reason: str = "played"

    @property
    def plays_anything(self) -> bool:
        return self.entry is not None or self.bridge


@dataclass
class PolicyConfig:
    min_gap_ms: float = 700.0
    hold_min_ms: float = 350.0
    hold_max_ms: float = 1000.0
    long_hold_min_ms: float = 900.0
    long_hold_max_ms: float = 1600.0
    #: Silence after an opener before a bridge line or the reply — the
    #: "thinking" beat the rubric asks for.
    post_opener_pause_ms: float = 550.0
    bridge_min_gap_ms: float = 2200.0
    max_vocal_run: int = 2
    repeat_window: int = 4
    #: Base weights for the first-sound categories before plan and history
    #: adjustments. "none" is weighted in on purpose: a reply after a pause is
    #: one of the natural first sounds, not a failure to fill.
    weight_none: float = 0.35
    #: The category the plan asked for, and any other playable category.
    weight_planned: float = 0.6
    weight_unplanned: float = 0.12
    #: Multiplier on the category used last turn: variety without overruling
    #: the plan outright.
    repeat_category_factor: float = 0.4
    #: At or above this predicted gap, choosing silence is not allowed.
    max_silent_gap_ms: float = 3000.0
    bridge_probability: float = 0.35


class OpenerPolicy:
    """Decides each turn's first sound from the plan plus recent history."""

    def __init__(
        self,
        config: Optional[PolicyConfig] = None,
        rng: Optional[random.Random] = None,
    ) -> None:
        self.config = config or PolicyConfig()
        self._rng = rng or random.Random()
        self._categories: Deque[str] = deque(maxlen=8)
        self._families: Deque[str] = deque(maxlen=max(1, self.config.repeat_window))
        self._last_bridge = False

    # ---- history ----------------------------------------------------

    def record(self, decision: OpenerDecision) -> None:
        """Advance history with what was decided this turn."""
        self._categories.append(decision.category)
        if decision.entry is not None:
            self._families.append(decision.entry.family)
        self._last_bridge = decision.bridge

    def _vocal_run(self) -> int:
        run = 0
        for category in reversed(self._categories):
            if category != "vocal":
                break
            run += 1
        return run

    # ---- choosing ---------------------------------------------------

    def _pick_entry(
        self,
        kinds: Sequence[str],
        plan: DeliveryPlan,
        catalog: SessionCatalog,
        durations: Dict[str, float],
        max_ms: float,
    ) -> Optional[CatalogEntry]:
        """The best playable entry of ``kinds``: plan order first, then any.

        Playable = rendered (has a duration), short enough to leave the post-
        opener pause before the reply, and not in a recently heard family.
        """

        def ok(entry: Optional[CatalogEntry]) -> bool:
            return (
                entry is not None
                and entry.kind in kinds
                and entry.id in durations
                and durations[entry.id] <= max_ms
                and entry.family not in self._families
            )

        for entry_id in plan.opener_ids:
            entry = catalog.get(entry_id)
            if ok(entry):
                return entry
        preferred = [
            e for e in catalog.entries.values() if ok(e) and e.kind == plan.opener_kind
        ]
        pool = preferred or [e for e in catalog.entries.values() if ok(e)]
        return self._rng.choice(pool) if pool else None

    def decide(
        self,
        plan: DeliveryPlan,
        catalog: Optional[SessionCatalog],
        durations: Dict[str, float],
        predicted_gap_ms: float,
        learner_text: Optional[str] = None,
        bridge_ms: Optional[float] = None,
    ) -> OpenerDecision:
        """This turn's first sound. Pure; call ``record`` with the result."""
        cfg = self.config
        if learner_is_leaving(learner_text):
            return OpenerDecision("none", reason="skipped_closing")
        if learner_seems_unfinished(learner_text):
            return OpenerDecision("none", reason="skipped_learner_unfinished")
        if predicted_gap_ms < cfg.min_gap_ms:
            return OpenerDecision("none", reason="skipped_fast_turn")
        if catalog is None or not durations:
            return OpenerDecision("none", reason="skipped_no_clips")

        long_hold = plan.hold_silence
        lo, hi = (
            (cfg.long_hold_min_ms, cfg.long_hold_max_ms)
            if long_hold
            else (cfg.hold_min_ms, cfg.hold_max_ms)
        )
        hold = self._rng.uniform(lo, hi)
        # Whatever plays must finish, plus the thinking beat, before the reply.
        room_ms = predicted_gap_ms - hold - cfg.post_opener_pause_ms

        last = self._categories[-1] if self._categories else None
        # The plan's own category leads clearly: in the first prod day, the old
        # 0.45 / 0.25 split played a different kind from the one planned on 5
        # of 11 openers (a "sigh" plan heard as "Hmm").
        planned_vocal = plan.opener_kind in VOCAL_KINDS
        planned_body = plan.opener_kind in BODY_KINDS
        weights: Dict[str, float] = {
            # A pause-fits plan mostly LENGTHENS the hold (above); it only
            # nudges toward saying nothing. At +0.4, planners that set it
            # freely left 12 of 16 live v2v turns silent.
            "none": cfg.weight_none + (0.15 if plan.hold_silence else 0.0),
            "vocal": cfg.weight_planned if planned_vocal else cfg.weight_unplanned,
            "body": cfg.weight_planned if planned_body else cfg.weight_unplanned,
        }
        if self._vocal_run() >= cfg.max_vocal_run:
            weights["vocal"] = 0.0
        if last in weights:
            weights[last] *= cfg.repeat_category_factor
        # Silence is a device for a SHORT beat, not for a long wait: in the
        # first prod day, turns where the policy chose nothing left the learner
        # in p50 5.7 s of total silence (23 of 34 decided turns). Above this
        # predicted gap, some sound always plays when one can.
        if predicted_gap_ms >= cfg.max_silent_gap_ms:
            weights["none"] = 0.0

        vocal = self._pick_entry(VOCAL_KINDS, plan, catalog, durations, room_ms)
        body = self._pick_entry(BODY_KINDS, plan, catalog, durations, room_ms)
        if vocal is None:
            weights["vocal"] = 0.0
        if body is None:
            weights["body"] = 0.0

        category = self._weighted(weights)

        bridge = False
        if (
            plan.bridge_line
            and bridge_ms is not None
            and not self._last_bridge
            and predicted_gap_ms >= cfg.bridge_min_gap_ms
        ):
            entry_ms = (
                durations.get(vocal.id, 0.0)
                if category == "vocal" and vocal
                else durations.get(body.id, 0.0) if category == "body" and body else 0.0
            )
            fits = room_ms - entry_ms - cfg.post_opener_pause_ms >= bridge_ms
            bridge = fits and self._rng.random() < cfg.bridge_probability

        if category == "vocal" and vocal is not None:
            return OpenerDecision("vocal", vocal, hold, bridge, "played")
        if category == "body" and body is not None:
            return OpenerDecision("body", body, hold, bridge, "played")
        if bridge:
            return OpenerDecision("none", None, hold, True, "played")
        return OpenerDecision("none", reason="skipped_policy")

    def _weighted(self, weights: Dict[str, float]) -> str:
        total = sum(max(0.0, w) for w in weights.values())
        if total <= 0:
            return "none"
        point = self._rng.uniform(0, total)
        running = 0.0
        order: List[str] = ["none", "vocal", "body"]
        for name in order:
            running += max(0.0, weights.get(name, 0.0))
            if point <= running:
                return name
        return "none"
