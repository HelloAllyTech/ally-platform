"""The working-memory record itself — derived fields only.

Every field here is INFERRED from the conversation. The authored half of the
rendered block — the active simulation state and its `state_x_guidelines` — is
deliberately absent: it is resolved per turn by
``_resolve_simulation_state_by_score`` and merged at render time
(design §3.1). Two reasons that split matters:

- the consolidation call rewrites what lives in this record, and a scenario
  designer's instruction must never be paraphrased into an approximation of
  itself;
- a stale store therefore cannot serve stale scenario guidance, because the
  guidance was never in the store to go stale.

Plain dataclasses rather than pydantic models: this is in-process state, deep
copied on every read, never serialised across a service boundary. The
consolidation call's OUTPUT is a separate structured-output model (phase 3) —
this is what the store holds after that output has been validated.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Literal, Optional

# The stance vocabulary is a STARTING POINT, not a finding. The design flags it
# as invented, and says the clinical vocabulary should win once someone who
# trains counsellors has looked at it. Kept as a Literal so a typo fails at the
# call site rather than silently becoming a sixth stance.
Stance = Literal["guarded", "testing", "opening", "disclosing", "reflecting"]
STANCES: tuple[Stance, ...] = (
    "guarded",
    "testing",
    "opening",
    "disclosing",
    "reflecting",
)

#: Focal-attention cap on recalled backstory (Cowan's 4±1). A cognitive bound
#: rather than a token budget — see design §7.4. Enforced at selection time.
SALIENT_BACKSTORY_CAP = 5


@dataclass
class Fact:
    """One thing the client knows or has said.

    `encoding_strength` and `last_recalled_turn` exist for the salience
    function (§7.3, §7.4); nothing computes them until phase 3.
    """

    text: str
    encoding_strength: float = 1.0
    first_seen_turn: int = 0
    last_recalled_turn: Optional[int] = None
    #: Distinct stances this fact has surfaced in — the spacing effect's
    #: "distinct phases", not a raw hit count (§7.4).
    stances_seen: List[str] = field(default_factory=list)


@dataclass
class Thread:
    """Something opened and not finished.

    Exempt from decay by design (Zeigarnik, §7.4): an unresolved thread cannot
    fade out however long since it was cued, which is the structural block on
    the actor proposing closure it has not earned.
    """

    topic: str
    opened_turn: int = 0
    closed_turn: Optional[int] = None

    @property
    def is_open(self) -> bool:
        return self.closed_turn is None


@dataclass
class WithheldTopic:
    """A subject the client is not ready to discuss.

    Carries the topic and the deflection ONLY — never the content. This is
    roleplay_v2's disclosure-ledger contract verbatim: the actor learns that a
    subject exists and how to move away from it, without ever having the
    material in context to leak. `_render_ledger_section` in
    app/roleplay_v2/actor/prompt_compiler.py is the reference rendering.
    """

    topic: str
    deflection: str
    #: locked -> unlocked -> revealed. Three states, not two: "the client may
    #: now discuss this" and "the client has discussed it" are different facts,
    #: and only the second should stop the actor deflecting.
    status: str = "locked"


@dataclass
class ClientWorkingMemory:
    """What the client currently has in mind. Derived; never authored."""

    stance: Stance = "guarded"
    affect: str = ""
    #: Why the stance is where it is. Filtered out of the rendered block — see
    #: the design's note on think_scrubber: this is scratchpad, not prompt text.
    appraisal: str = ""

    # ---- voice: the direct repair for the 2026-08-06 role-slip regression ----
    register: str = ""
    #: 2-3 VERBATIM fragments of the client's own recent speech. The rolling
    #: summary carries facts and no voice, which is what removed the actor's
    #: only in-context style exemplars.
    speech_fragments: List[str] = field(default_factory=list)

    # ---- the client's own history, as cues ----
    disclosed: List[Fact] = field(default_factory=list)
    unresolved: List[Thread] = field(default_factory=list)
    withheld: List[WithheldTopic] = field(default_factory=list)

    # ---- recalled, not dumped ----
    salient_backstory: List[Fact] = field(default_factory=list)
    #: Topics the off-path updater nominated for the NEXT turn's recall —
    #: roleplay_v2's `retrieve_topics`, which persona_bible already knows how to
    #: rank against (§9.1).
    retrieve_cues: List[str] = field(default_factory=list)

    # ---- bookkeeping ----
    #: -1 until the first turn opens, matching `updated_by_turn` and the store's
    #: `last_committed_turn`. Not 0: `begin_turn` pre-increments, so a 0 default
    #: makes "no turn has opened" indistinguishable from "turn 0 is in
    #: progress", and the update node cannot then refuse to consolidate a turn
    #: that never happened.
    turn_index: int = -1
    #: Highest turn whose update has been committed. The monotonic key that
    #: replaces the design's original SHA-256 `revision` field: these writes
    #: have a natural order, so content hashing buys nothing (§9.1).
    updated_by_turn: int = -1
    #: Ordered stances visited, so `phase_diversity` can count DISTINCT phases
    #: a fact surfaced in rather than raw recurrences (§7.4).
    stance_path: List[str] = field(default_factory=list)
    turns_in_stance: int = 0
    #: Health counters, mirroring roleplay_v2's director_commits/misses. A miss
    #: is an update that timed out — the turn goes undirected rather than late.
    updates_committed: int = 0
    updates_missed: int = 0

    def __post_init__(self) -> None:
        if not self.stance_path:
            self.stance_path = [self.stance]

    @property
    def staleness_turns(self) -> int:
        """Turns since the last committed update.

        The design asks for this in §5.1: without it a reader cannot tell a
        client model that is current from one whose updater has been failing
        silently. 0 when nothing has ever committed and no turn has run.
        """
        if self.updated_by_turn < 0:
            # Nothing has ever committed, so staleness is every turn so far.
            # turn_index is 0-based, so that is index+1 — returning the index
            # itself would undercount by one and report a one-turn-old memory
            # as fresh.
            return max(0, self.turn_index + 1)
        return max(0, self.turn_index - self.updated_by_turn)

    @property
    def open_threads(self) -> List[Thread]:
        return [t for t in self.unresolved if t.is_open]

    @property
    def may_propose_closure(self) -> bool:
        """False while any thread is still open.

        The mechanism behind the failure in §1: a client who declares insight at
        turn 14 hands the trainee a fake success. Prose instructions have not
        stopped it; an open thread makes the claim structurally false.
        """
        return not self.open_threads

    def distinct_stances(self) -> Dict[str, int]:
        """How many turns were spent in each stance visited."""
        counts: Dict[str, int] = {}
        for stance in self.stance_path:
            counts[stance] = counts.get(stance, 0) + 1
        return counts
