"""The LLM proposes, code disposes.

The updater's output is untrusted input that happens to arrive as structured
output. What code still disposes of: capping every free-text field, pairing the
withheld ledger positionally, and dropping blanks and duplicates.

What it no longer disposes of is PROGRESSION. There used to be a stance ladder
here — five fixed rungs, an earned-advance rule, a two-turn dwell gate, a
one-rung clamp and an event taxonomy to feed it — and roughly thirty tests
enforcing it. All of it was ours, not the product's: no scenario author ever
asked for `guarded -> testing -> opening -> disclosing -> reflecting`. The
author's states decide where the client is, the stance mirrors the resolved
state, and a second controller for the same decision was the bug rather than
the safeguard.
"""

from app.core.working_memory import ClientWorkingMemory
from app.core.working_memory.proposal import (
    MAX_APPRAISAL_CHARS,
    MAX_CUE_CHARS,
    MAX_LEDGER_ITEM_CHARS,
    MAX_STATE_FIELD_CHARS,
    MAX_TOPIC_CHARS,
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
    return ProposedUpdate(**kw)


# ---------------------------------------------------------------------------
# The author decides where the client is
# ---------------------------------------------------------------------------


def test_the_authored_stance_is_taken_verbatim():
    result = validate(_proposal(), _memory("guarded"), (), authored_stance="resolved")
    assert result.stance == "resolved"


def test_no_authored_stance_leaves_the_stance_alone():
    # A scenario with no states has no progression for anyone to adjudicate.
    result = validate(_proposal(), _memory("guarded"), ())
    assert result.stance is None


def test_restating_the_current_stance_is_not_a_transition():
    # None means "no change to commit", which keeps `stance_path` honest.
    result = validate(_proposal(), _memory("guarded"), (), authored_stance="guarded")
    assert result.stance is None


def test_the_updater_cannot_propose_a_stance_or_an_event():
    # Not merely ignored — absent from the schema, so the model is never asked
    # and cannot spend attention on a field nothing reads.
    fields = set(ProposedUpdate.model_fields)
    assert "stance" not in fields
    assert "events" not in fields


# ---------------------------------------------------------------------------
# Caps and the withheld ledger — what code still disposes of
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


# ---------------------------------------------------------------------------
# The withheld ledger pairs two parallel lists — alignment is the whole thing
# ---------------------------------------------------------------------------


def test_a_blank_topic_does_not_shift_later_deflections():
    # The reported bug. Cleaning the topics BEFORE pairing shifted every later
    # deflection up one, so "her brother" was handed the padding entry meant for
    # the blank. A mismatched excuse is a visible character break, which is
    # worse than no excuse at all.
    out = validate(
        _proposal(
            withheld_topics=["the hospital visit", "", "her brother"],
            withheld_deflections=[
                "says she is fine and asks about work",
                "(padding for the blank)",
                "changes the subject to her mother",
            ],
        ),
        _memory(),
    )
    assert out.withheld == [
        ("the hospital visit", "says she is fine and asks about work"),
        ("her brother", "changes the subject to her mother"),
    ]


def test_a_duplicate_topic_does_not_shift_later_deflections():
    out = validate(
        _proposal(
            withheld_topics=["the visit", "the visit", "the money"],
            withheld_deflections=["asks about work", "(dropped)", "goes quiet"],
        ),
        _memory(),
    )
    assert out.withheld == [
        ("the visit", "asks about work"),
        ("the money", "goes quiet"),
    ]


def test_a_missing_deflection_falls_back_without_stealing_another():
    # Fewer deflections than topics: the unmatched topic gets the fallback, and
    # must not borrow a neighbour's.
    out = validate(
        _proposal(
            withheld_topics=["the visit", "the money"],
            withheld_deflections=["asks about work"],
        ),
        _memory(),
    )
    assert out.withheld[0] == ("the visit", "asks about work")
    assert out.withheld[1][0] == "the money"
    assert out.withheld[1][1] == "change the subject naturally"


def test_a_blank_deflection_falls_back_rather_than_rendering_empty():
    out = validate(
        _proposal(withheld_topics=["the visit"], withheld_deflections=["   "]),
        _memory(),
    )
    assert out.withheld == [("the visit", "change the subject naturally")]


def test_surplus_deflections_are_ignored():
    out = validate(
        _proposal(
            withheld_topics=["the visit"],
            withheld_deflections=["asks about work", "unused", "also unused"],
        ),
        _memory(),
    )
    assert out.withheld == [("the visit", "asks about work")]


def test_the_cap_counts_kept_pairs_not_raw_positions():
    # Blanks interleaved with real topics must not eat the budget, or a padded
    # list would silently drop real withheld topics.
    topics, deflections = [], []
    for i in range(12):
        topics += [f"topic {i}", ""]
        deflections += [f"deflection {i}", "padding"]
    out = validate(
        _proposal(withheld_topics=topics, withheld_deflections=deflections),
        _memory(),
    )
    assert len(out.withheld) == 10
    assert out.withheld[9] == ("topic 9", "deflection 9")


# ---------------------------------------------------------------------------
# Evidence is required to EARN, not merely requested
# ---------------------------------------------------------------------------


def test_state_fields_are_capped():
    out = validate(
        _proposal(affect="x" * 500, voice_register="y" * 500, appraisal="z" * 900),
        _memory(),
    )
    assert len(out.affect) == MAX_STATE_FIELD_CHARS
    assert len(out.register) == MAX_STATE_FIELD_CHARS
    assert len(out.appraisal) == MAX_APPRAISAL_CHARS


def test_ledger_items_are_capped():
    out = validate(
        _proposal(
            disclosed=["d" * 400],
            opened_threads=["t" * 400],
            retrieve_cues=["c" * 400],
            withheld_topics=["w" * 400],
            withheld_deflections=["f" * 400],
        ),
        _memory(),
    )
    assert len(out.disclosed[0]) == MAX_LEDGER_ITEM_CHARS
    assert len(out.opened_threads[0]) == MAX_TOPIC_CHARS
    assert len(out.retrieve_cues[0]) == MAX_CUE_CHARS
    assert len(out.withheld[0][0]) == MAX_TOPIC_CHARS
    assert len(out.withheld[0][1]) == MAX_LEDGER_ITEM_CHARS


def test_normal_length_values_are_untouched():
    # The caps must never clip real output: measured ranges were affect 8-31
    # chars and register 4-19.
    out = validate(
        _proposal(affect="anxious but slightly relieved", voice_register="clipped"),
        _memory(),
    )
    assert out.affect == "anxious but slightly relieved"
    assert out.register == "clipped"


# ---------------------------------------------------------------------------
# Helpful behaviour as an advancing event
# ---------------------------------------------------------------------------
#
# Reported from prod (scenario 440): the score climbed 10 -> 104 across four
# configured states while the ladder moved only on updater-proposed events, so
# the state machine and the stance ladder disagreed and it read as "the states
# stopped doing anything".


def test_delivery_is_required_in_the_schema_but_an_omission_is_tolerated():
    """Optional, gpt-4o-mini left it out of Hindi updates in prod V2V
    (2026-10-16); required, structured output always emits it."""
    schema = ProposedUpdate.model_json_schema()
    assert "delivery" in schema.get("required", [])
    assert ProposedUpdate(affect="calm").delivery is None
