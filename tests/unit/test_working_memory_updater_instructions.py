"""The updater prompt is one prompt, readable end to end.

Nothing is injected as prose any more. There used to be three placeholders
carrying prompt SENTENCES from Python — an events taxonomy, a stance-ladder
rulebook and a scenario framing — so a reader of the prompt file could not see
what the prompt actually said. Two went with the ladder they served; the third
became what it should always have been: two data placeholders under sentences
that live in the template.

These tests pin the contract those placeholders have with the template.
"""

from app.core.working_memory.consolidate import (
    _TEMPLATE_PATH,
    NO_AUTHORED_STAGES,
    NO_CURRENT_STAGE,
)
from app.prompts.resolver import load_and_format

LADDER = (
    "  1. anxious — frightened, gives short answers\n"
    "  2. partial resolution — begins to trust\n"
    "  3. resolved — speaks openly"
)


def _render(ladder=LADDER, current="partial resolution"):
    return load_and_format(
        _TEMPLATE_PATH,
        None,
        language_label="Malayalam",
        stance_ladder=ladder,
        current_stance=current,
    )


def test_the_authors_stages_and_the_current_one_reach_the_model():
    text = _render()
    assert "begins to trust" in text  # the author's own words, not a paraphrase
    assert "The client is at: partial resolution" in text


def test_the_framing_sentences_live_in_the_template_not_in_python():
    # The point of the whole change: someone reading the .txt sees the prompt.
    body = load_and_format(
        _TEMPLATE_PATH, None, language_label="x", stance_ladder="L", current_stance="C"
    )
    assert "treat as ground truth" in body
    assert "Do not record a subject the current stage invites as withheld" in body


def test_a_scenario_with_no_stages_names_the_absence():
    # Never a blank line under a heading: a blank reads to the model as an
    # absence of constraint where a named absence reads as an absence of data.
    text = _render(ladder=NO_AUTHORED_STAGES, current=NO_CURRENT_STAGE)
    assert "defines no stages" in text
    assert "judge from the turns alone" in text


def test_the_template_asks_for_no_stance_and_no_events():
    text = _render()
    assert "- stance:" not in text
    assert "- events:" not in text


def test_every_placeholder_is_filled():
    assert "{" not in _render()
