"""The LLM proposes, code disposes.

Salvaged from roleplay_v2's DirectorService._apply (design §9.1). §3 says a
stance transition must be EARNED but does not say who enforces it; this module
is the answer, and these tests are the enforcement.

The failure this exists to prevent is measured, not hypothetical: §1's critical
persona annotations are all the client declaring insight it has not reached —
"I'm starting to see the pattern a little more clearly now. Thank you for
today!" at turn 14 — which hands the trainee a fake success and inflates their
score. A model asked nicely to only advance when earned will sometimes do it
anyway. So the proposal is untrusted input that happens to arrive as structured
output.
"""

from app.core.working_memory import ClientWorkingMemory, Thread
from app.core.working_memory.proposal import (
    MIN_TURNS_BEFORE_ADVANCE,
    STANCE_ORDER,
    ObservedEvent,
    ProposedUpdate,
    validate,
)


def _memory(stance="guarded", turns_in_stance=5, **kw):
    m = ClientWorkingMemory(stance=stance)
    m.turns_in_stance = turns_in_stance
    for k, v in kw.items():
        setattr(m, k, v)
    return m


def _proposal(**kw):
    events = [ObservedEvent(kind=k) for k in kw.pop("event_kinds", [])]
    return ProposedUpdate(events=events, **kw)


# ---------------------------------------------------------------------------
# Advancing has to be earned
# ---------------------------------------------------------------------------


def test_a_bare_stance_claim_is_refused():
    out = validate(_proposal(stance="testing"), _memory())
    assert out.stance is None
    assert "earned, not asserted" in out.stance_rejected_reason


def test_an_advancing_event_earns_one_rung():
    out = validate(
        _proposal(stance="testing", event_kinds=["repair"]), _memory("guarded")
    )
    assert out.stance == "testing"
    assert out.stance_rejected_reason is None


def test_the_ladder_cannot_be_skipped():
    # Guarded to reflecting because one question landed well IS the §1 failure.
    # The overshoot is CLAMPED to one rung rather than refused: the repair earned
    # an advance, so throwing the move away entirely would discard real evidence
    # over a bad quantity. Refusing outright froze the stance for a whole session
    # in the first offline run, because the updater overshot on nearly every turn.
    out = validate(
        _proposal(stance="reflecting", event_kinds=["repair"]), _memory("guarded")
    )
    assert out.stance == STANCE_ORDER[1]
    assert out.stance_rejected_reason is None


def test_a_clamped_advance_still_obeys_the_other_gates():
    # The clamp must not become a way around the gates it is not about.
    too_soon = validate(
        _proposal(stance="opening", event_kinds=["repair"]),
        _memory("guarded", turns_in_stance=MIN_TURNS_BEFORE_ADVANCE - 1),
    )
    assert too_soon.stance is None
    assert "required before advancing" in too_soon.stance_rejected_reason


def test_a_clamped_advance_respects_the_zeigarnik_block():
    # From the rung below `reflecting`, any overshoot clamps ONTO the gated
    # rung — the one case where the clamp lands on it, so the thread check has
    # to be applied to the TARGET rather than to what was proposed. Derived
    # from STANCE_ORDER rather than hardcoded: naming the stance here would
    # make inserting a rung look like a regression.
    memory = _memory(STANCE_ORDER[-2], turns_in_stance=5)
    memory.unresolved = [Thread(topic="the argument", opened_turn=1)]
    out = validate(_proposal(stance="reflecting", event_kinds=["repair"]), memory)
    assert out.stance is None
    assert "still open" in out.stance_rejected_reason


def test_advancing_too_soon_is_refused():
    # Without a minimum the actor oscillates turn to turn, which reads as
    # instability rather than as a person.
    out = validate(
        _proposal(stance="testing", event_kinds=["resistance_softened"]),
        _memory("guarded", turns_in_stance=MIN_TURNS_BEFORE_ADVANCE - 1),
    )
    assert out.stance is None
    assert "required before advancing" in out.stance_rejected_reason


def test_disclosing_something_new_counts_as_advancing():
    # Revealing something IS the client opening up, not merely bookkeeping.
    out = validate(
        _proposal(stance="opening", event_kinds=["disclosed"]), _memory("testing")
    )
    assert out.stance == "opening"


# ---------------------------------------------------------------------------
# The Zeigarnik block on reflecting
# ---------------------------------------------------------------------------


def test_reflecting_is_unreachable_while_a_thread_is_open():
    out = validate(
        _proposal(stance="reflecting", event_kinds=["repair"]),
        _memory("disclosing", unresolved=[Thread("the argument with mum")]),
    )
    assert out.stance is None
    assert "still open" in out.stance_rejected_reason


def test_reflecting_opens_up_once_everything_is_closed():
    out = validate(
        _proposal(stance="reflecting", event_kinds=["repair"]),
        _memory("disclosing", unresolved=[Thread("money", closed_turn=6)]),
    )
    assert out.stance == "reflecting"


# ---------------------------------------------------------------------------
# Regression is immediate — the other half of contingency
# ---------------------------------------------------------------------------


def test_a_rupture_closes_the_client_up_at_once():
    # No minimum-turns gate on the way down. A client who feels judged closes up
    # now; making them wait two turns would be the same uniform-responsiveness
    # failure §1 measures, just from the other direction.
    out = validate(
        _proposal(stance="guarded", event_kinds=["rupture"]),
        _memory("disclosing", turns_in_stance=0),
    )
    assert out.stance == "guarded"


def test_drifting_shut_one_rung_needs_no_event():
    out = validate(_proposal(stance="testing"), _memory("opening", turns_in_stance=0))
    assert out.stance == "testing"


def test_collapsing_several_rungs_needs_a_rupture():
    out = validate(_proposal(stance="guarded"), _memory("reflecting"))
    assert out.stance is None
    assert "more than one rung without a rupture" in out.stance_rejected_reason


# ---------------------------------------------------------------------------
# Malformed proposals
# ---------------------------------------------------------------------------


def test_an_invented_stance_is_discarded():
    # A model asked for an enum will occasionally return something else, and a
    # typo must not become a sixth rung.
    out = validate(
        _proposal(stance="vulnerable", event_kinds=["repair"]), _memory("guarded")
    )
    assert out.stance is None
    assert "unknown stance" in out.stance_rejected_reason


def test_unknown_event_kinds_are_dropped_and_cannot_earn():
    out = validate(
        _proposal(stance="testing", event_kinds=["felt_seen", "vibed"]),
        _memory("guarded"),
    )
    assert out.stance is None
    assert out.events == []


def test_restating_the_current_stance_is_not_a_transition():
    out = validate(
        _proposal(stance="guarded", event_kinds=["repair"]), _memory("guarded")
    )
    assert out.stance is None
    assert out.stance_rejected_reason is None


# ---------------------------------------------------------------------------
# Bounds on the free-text fields
# ---------------------------------------------------------------------------


def test_voice_fragments_are_capped_in_count_and_length():
    # Long enough to carry a speech habit, short enough that the model cannot
    # smuggle a whole reply in as "voice".
    out = validate(
        _proposal(speech_fragments=["a" * 500, "I guess", "yeah", "hmm", "ok"]),
        _memory(),
    )
    assert len(out.speech_fragments) == 3
    assert all(len(f) <= 120 for f in out.speech_fragments)


def test_blank_and_duplicate_entries_are_dropped():
    out = validate(
        _proposal(disclosed=["lost the job", "  ", "lost the job", ""]), _memory()
    )
    assert out.disclosed == ["lost the job"]


def test_a_withheld_topic_always_gets_a_usable_deflection():
    # The actor has to know HOW to move away, not merely that it should. A
    # missing deflection degrades to a usable instruction, never an empty one.
    out = validate(
        _proposal(
            withheld_topics=["the diagnosis", "the debt"],
            withheld_deflections=["say it is nothing"],
        ),
        _memory(),
    )
    assert out.withheld[0] == ("the diagnosis", "say it is nothing")
    assert out.withheld[1][1] == "change the subject naturally"


def test_empty_free_text_becomes_none_not_an_empty_string():
    # None means "not part of this update" to the store; "" would blank a field
    # the other update path owns.
    out = validate(_proposal(affect="   ", voice_register=""), _memory())
    assert out.affect is None
    assert out.register is None
