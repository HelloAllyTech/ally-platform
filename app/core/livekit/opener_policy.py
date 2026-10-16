"""Turn-time rules for what the learner hears before the reply. Deterministic.

The delivery plan (``delivery.py``) says what FITS the character; this module
decides what actually PLAYS on a given turn, and when:

* **Pause first.** A randomised hold before anything, longer when the plan says a
  pause fits. A reply after a pause is one of the natural first sounds.
* **One filler at most**, chosen from the plan's own suggestions. Variety comes
  from moving down the planner's list (and a no-repeat window over sound
  FAMILIES: hmm / hmmm / hmm… are one family), never from overruling it: the
  previous rules replaced the planned kind on ~60% of prod turns.
* **Then the interim, piece by piece, while the wait lasts.** The gaps between
  pieces lengthen a little each time, the way a person thinking aloud slows
  down, and a piece plays only if it ends in time to leave a short beat before
  the reply::

      gap before piece k   gₖ = PIECE_GAP · GROWTHᵏ        (0.35, 0.49, 0.69 s …)
      piece k plays only if   t + gₖ + dₖ ≤ W − TAIL       (W = predicted wait)
      and all speech so far   ≤ MAX_SPEECH_SHARE · W

  So a short wait gets nothing, a medium one a pause and a filler, and a long one
  (ElevenLabs v3, 6-8 s) a filler and two or three pieces.
* **Nothing over the learner.** Declines when the learner's last words read as
  unfinished, and the runner cancels on any learner speech.
* **Nothing before a goodbye**, and nothing on a turn predicted to be fast.

Scenarios without working memory keep the default plan: a filler or a pause,
rotating the kind of sound, and never an interim.

The policy is pure — state in, decision out — so every rule is testable without
a room, a TTS or a clock.
"""

from __future__ import annotations

import random
import re
from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Sequence, Tuple

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

    #: The filler's category: "none" | "vocal" | "body".
    category: str
    entry: Optional[CatalogEntry] = None
    #: Silence before the first sound, in ms.
    hold_ms: float = 0.0
    #: How many of the plan's interim pieces follow, in order.
    pieces: int = 0
    #: The silence before each of those pieces, in ms.
    gaps_ms: Tuple[float, ...] = ()
    #: Why — recorded on the turn metrics.
    reason: str = "played"

    @property
    def plays_anything(self) -> bool:
        return self.entry is not None or self.pieces > 0


@dataclass
class PolicyConfig:
    min_gap_ms: float = 700.0
    hold_min_ms: float = 300.0
    hold_max_ms: float = 600.0
    #: The hold when the plan says a pause fits: a real pause, not a beat.
    long_hold_min_ms: float = 1200.0
    long_hold_max_ms: float = 2000.0
    #: The gap before the first interim piece that follows a sound, and how
    #: much longer each later gap is.
    piece_gap_ms: float = 350.0
    piece_gap_growth: float = 1.4
    #: Silence left between the last sound and the predicted reply, so the
    #: answer doesn't land glued to the holding words.
    tail_ms: float = 500.0
    max_pieces: int = 3
    #: Speech never fills more than this share of the predicted wait.
    max_speech_share: float = 0.7
    #: A breath or sigh may play at most once in this many turns. Body sounds
    #: are the most noticeable openers; a prod session whose small planner asked
    #: for "sigh" on all 8 plans heard a breath or sigh on 4 of 9 turns.
    body_min_gap_turns: int = 4
    repeat_window: int = 4
    #: Default plan (no working memory) only: on a wait shorter than this, a
    #: pause alone stands in for the filler this often.
    pause_only_max_gap_ms: float = 2000.0
    pause_only_probability: float = 0.35


#: What a "silence" plan plays if the wait outlasts the pause.
_AFTER_A_PAUSE = ("breath", "reflective", "hum")


class OpenerPolicy:
    """Decides each turn's opening from the plan plus recent history."""

    def __init__(
        self,
        config: Optional[PolicyConfig] = None,
        rng: Optional[random.Random] = None,
    ) -> None:
        self.config = config or PolicyConfig()
        self._rng = rng or random.Random()
        self._categories: Deque[str] = deque(maxlen=8)
        self._families: Deque[str] = deque(maxlen=max(1, self.config.repeat_window))
        self._last_kind: Optional[str] = None

    # ---- history ----------------------------------------------------

    def record(self, decision: OpenerDecision) -> None:
        """Advance history with what was decided this turn."""
        self._categories.append(decision.category)
        if decision.entry is not None:
            self._families.append(decision.entry.family)
            self._last_kind = decision.entry.kind

    def _body_recent(self) -> bool:
        """Whether a body sound played within the last body_min_gap_turns - 1."""
        window = max(0, self.config.body_min_gap_turns - 1)
        return window > 0 and "body" in list(self._categories)[-window:]

    # ---- choosing ---------------------------------------------------

    def _pick_filler(
        self,
        plan: DeliveryPlan,
        catalog: SessionCatalog,
        durations: Dict[str, float],
        max_ms: float,
    ) -> Optional[CatalogEntry]:
        """The filler to play: the plan's own choice whenever one can play.

        Playable = rendered, short enough to fit, not in a recently heard
        family, and not a body sound inside its spacing window. Order: the
        plan's ids, then the plan's kind, then the nearest kind in the same
        category, then any spoken filler.
        """

        def ok(entry: Optional[CatalogEntry]) -> bool:
            return (
                entry is not None
                and entry.id in durations
                and durations[entry.id] <= max_ms
                and entry.family not in self._families
                and not (entry.kind in BODY_KINDS and self._body_recent())
            )

        entries = [e for e in catalog.entries.values() if ok(e)]
        if not entries:
            return None
        if plan.source == "default":
            # No planner: rotate the kind of sound so it isn't "Hmm" every turn.
            fresh = [e for e in entries if e.kind != self._last_kind]
            return self._rng.choice(fresh or entries)
        for entry_id in plan.opener_ids:
            entry = catalog.get(entry_id)
            if ok(entry):
                return entry
        kinds = _AFTER_A_PAUSE if plan.opener_kind == "silence" else (plan.opener_kind,)
        for kind in kinds:
            same = [e for e in entries if e.kind == kind]
            if same:
                return self._rng.choice(same)
        # Every family of the planned kind was heard recently. Stay with the
        # kind — it is the character's state — and take the one heard longest
        # ago, never the one just played.
        recent = list(self._families)
        for kind in kinds:
            stale = [
                e
                for e in catalog.entries.values()
                if e.kind == kind
                and e.id in durations
                and durations[e.id] <= max_ms
                and (not recent or e.family != recent[-1])
                and not (e.kind in BODY_KINDS and self._body_recent())
            ]
            if stale:
                return min(
                    stale,
                    key=lambda e: (
                        recent.index(e.family) if e.family in recent else -1
                    ),
                )
        category = BODY_KINDS if plan.opener_kind in BODY_KINDS else VOCAL_KINDS
        near = [e for e in entries if e.kind in category]
        spoken = [e for e in entries if e.kind in VOCAL_KINDS]
        pool = near or spoken
        return self._rng.choice(pool) if pool else None

    def decide(
        self,
        plan: DeliveryPlan,
        catalog: Optional[SessionCatalog],
        durations: Dict[str, float],
        predicted_gap_ms: float,
        learner_text: Optional[str] = None,
        piece_ms: Sequence[float] = (),
    ) -> OpenerDecision:
        """This turn's opening. Pure; call ``record`` with the result.

        ``piece_ms`` is the rendered length of each of the plan's interim
        pieces, in order; a piece not rendered yet ends the list.
        """
        cfg = self.config
        if learner_is_leaving(learner_text):
            return OpenerDecision("none", reason="skipped_closing")
        if learner_seems_unfinished(learner_text):
            return OpenerDecision("none", reason="skipped_learner_unfinished")
        if predicted_gap_ms < cfg.min_gap_ms:
            return OpenerDecision("none", reason="skipped_fast_turn")
        if (catalog is None or not durations) and not piece_ms:
            return OpenerDecision("none", reason="skipped_no_clips")

        pause_fits = plan.hold_silence or plan.opener_kind == "silence"
        lo, hi = (
            (cfg.long_hold_min_ms, cfg.long_hold_max_ms)
            if pause_fits
            else (cfg.hold_min_ms, cfg.hold_max_ms)
        )
        hold = self._rng.uniform(lo, hi)
        # Every sound must end by here, leaving the beat before the reply.
        speech_ends_by = predicted_gap_ms - cfg.tail_ms
        speech_cap = cfg.max_speech_share * predicted_gap_ms
        t = hold

        entry = None
        if catalog is not None and durations:
            entry = self._pick_filler(
                plan, catalog, durations, min(speech_ends_by - t, speech_cap)
            )
        if (
            entry is not None
            and plan.source == "default"
            and predicted_gap_ms < cfg.pause_only_max_gap_ms
            and self._rng.random() < cfg.pause_only_probability
        ):
            entry = None  # a pause alone, the other natural opening
        spoken = 0.0
        if entry is not None:
            t += durations[entry.id]
            spoken += durations[entry.id]

        gaps = self._fit_pieces(
            piece_ms, t, spoken, entry is not None, speech_ends_by, speech_cap
        )
        if entry is not None and not gaps and piece_ms:
            # A sound OR a line: the wait holds one but not both. The line says
            # more, so it goes alone, opening after the pause. Prod V2V
            # (2026-10-16): on ~2.5 s English waits a filler always played and
            # the interim never fit behind it, leaving 1.1-1.8 s of silence.
            alone = self._fit_pieces(
                piece_ms, hold, 0.0, False, speech_ends_by, speech_cap
            )
            if alone:
                entry, gaps = None, alone

        category = (
            "none" if entry is None else "body" if entry.kind in BODY_KINDS else "vocal"
        )
        if entry is None and not gaps:
            return OpenerDecision("none", reason="skipped_policy")
        return OpenerDecision(category, entry, hold, len(gaps), tuple(gaps), "played")

    def _fit_pieces(
        self,
        piece_ms: Sequence[float],
        t: float,
        spoken: float,
        after_a_sound: bool,
        speech_ends_by: float,
        speech_cap: float,
    ) -> List[float]:
        """The gaps before each interim piece that fits, starting at ``t``."""
        cfg = self.config
        gaps: List[float] = []
        for d in list(piece_ms)[: cfg.max_pieces]:
            # No gap before a piece that opens the turn: the hold is its pause.
            if not after_a_sound and not gaps:
                gap = 0.0
            else:
                gap = cfg.piece_gap_ms * cfg.piece_gap_growth ** len(gaps)
            if t + gap + d > speech_ends_by or spoken + d > speech_cap:
                break
            t += gap + d
            spoken += d
            gaps.append(gap)
        return gaps
