"""The updater prompt asks for events only where something still reads them.

`kinds` decides exactly one thing — whether the generic ladder advances. When
the scenario has authored states, `validate` takes the author's stance
verbatim and discards `kinds`, so the taxonomy is paid for and thrown away.
These tests pin the gate, because the failure it prevents is silent: a prompt
that asks for work nobody consumes looks exactly like one that doesn't.
"""

from app.core.working_memory.consolidate import (
    _events_instruction,
    _scenario_instruction,
    _stance_instruction,
)
from app.core.working_memory.proposal import (
    ADVANCING_EVENTS,
    CLIENT_EVENTS,
    HELPFUL_BEHAVIOUR,
    REGRESSING_EVENTS,
)

# The kinds that were removed: each duplicated a field the same call already
# returns, and none of them ever moved a stance.
RETIRED_KINDS = ("withheld", "affect_shift", "thread_opened", "thread_closed")


def test_authored_states_do_not_ask_for_the_taxonomy():
    text = _events_instruction(True)
    assert "leave this list EMPTY" in text
    for kind in ("repair", "resistance_softened", "rupture"):
        assert kind not in text


def test_no_authored_states_still_asks_for_the_taxonomy():
    text = _events_instruction(False)
    for kind in ("repair", "resistance_softened", "disclosed", "rupture"):
        assert kind in text


def test_retired_kinds_are_asked_for_on_neither_path():
    for has_states in (True, False):
        text = _events_instruction(has_states)
        for kind in RETIRED_KINDS:
            assert kind not in text, f"{kind} still requested (states={has_states})"


def test_gated_instruction_is_materially_shorter():
    assert len(_events_instruction(True)) < len(_events_instruction(False)) / 3


def test_client_events_is_exactly_what_decides_something():
    assert CLIENT_EVENTS == ADVANCING_EVENTS | REGRESSING_EVENTS
    for kind in RETIRED_KINDS:
        assert kind not in CLIENT_EVENTS


def test_helpful_behaviour_survives_the_trim():
    # Derived in code from the author's own score configuration, never from
    # the updater — the one advancing event with no LLM in its path.
    assert HELPFUL_BEHAVIOUR in CLIENT_EVENTS


def test_authored_states_do_not_ask_for_a_stance():
    assert "DO NOT report this" in _stance_instruction(True, "  1. anxious")


def test_no_authored_states_gets_the_ladder_verbatim():
    text = _stance_instruction(False, "  1. anxious\n  2. resolved")
    assert "1. anxious" in text and "2. resolved" in text
    assert "AT MOST ONE rung" in text


# ---------------------------------------------------------------------------
# The author's scenario, as ground truth for the ledger
# ---------------------------------------------------------------------------

LADDER = (
    "  1. anxious — frightened, gives short answers\n"
    "  2. partial resolution — begins to trust\n"
    "  3. resolved — speaks openly"
)


def test_the_arc_and_the_current_stage_both_reach_the_updater():
    text = _scenario_instruction("partial resolution", LADDER)
    assert "ground truth" in text
    assert "begins to trust" in text  # the author's own words, not a paraphrase
    assert "The client is at: partial resolution" in text


def test_the_scenario_block_grounds_the_ledger_without_deciding_a_stance():
    # It says how to INFER what is withheld; it must not hand back the stance
    # decision the stance instruction just took away.
    text = _scenario_instruction("anxious", LADDER)
    assert "Do not record a subject the current stage invites as withheld" in text
    assert "report" not in text.lower().replace("ground truth", "")


def test_a_stage_silent_on_a_subject_defers_to_the_turns():
    # The point of the whole block: an author rarely enumerates what the client
    # holds back, so the updater still has to infer — just not blindly.
    #
    # And it infers from the author's words only. No claim is made here about
    # how stages relate to one another: "later stage" reasoning is exactly the
    # monotonic assumption the ladder used to make for every scenario.
    assert "against the turns" in _scenario_instruction("anxious", LADDER)


def test_nothing_authored_renders_nothing():
    # With no states the ladder IS the scenario and `stance_instruction` already
    # carries it in full; repeating it here would be two copies to disagree.
    assert _scenario_instruction(None, "") == ""


def test_the_block_makes_no_claim_about_how_stages_relate():
    # Ordering the stages is factual (the author's score bands are ordered).
    # Inferring that later stages hold more disclosure is not, and a scenario
    # that opens with a confession and closes guarded must not be read
    # backwards.
    text = _scenario_instruction("anxious", LADDER)
    for phrase in ("later stage", "earlier stage", "further along", "progress"):
        assert phrase not in text.lower(), phrase
