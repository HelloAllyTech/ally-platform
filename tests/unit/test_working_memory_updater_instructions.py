"""The updater prompt asks for events only where something still reads them.

`kinds` decides exactly one thing — whether the generic ladder advances. When
the scenario has authored states, `validate` takes the author's stance
verbatim and discards `kinds`, so the taxonomy is paid for and thrown away.
These tests pin the gate, because the failure it prevents is silent: a prompt
that asks for work nobody consumes looks exactly like one that doesn't.
"""

from app.core.working_memory.consolidate import _events_instruction, _stance_instruction
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
