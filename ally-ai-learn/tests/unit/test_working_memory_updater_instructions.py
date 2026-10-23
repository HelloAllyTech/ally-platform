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
        state_ladder=ladder,
        current_state=current,
    )


def test_the_authors_stages_and_the_current_one_reach_the_model():
    text = _render()
    assert "begins to trust" in text  # the author's own words, not a paraphrase
    assert "The client is at: partial resolution" in text


def test_the_framing_sentences_live_in_the_template_not_in_python():
    # The point of the whole change: someone reading the .txt sees the prompt.
    body = load_and_format(
        _TEMPLATE_PATH, None, language_label="x", state_ladder="L", current_state="C"
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


def test_speech_fragments_must_stay_in_the_session_language():
    # The actor imitates speech_fragments for voice, so one recorded phrase in
    # another language compounds turn over turn: an English prod session saved
    # "koi baat nahi" and was fully Hinglish two turns later.
    text = _render()
    fragments_rule = next(
        line for line in text.splitlines() if line.startswith("- speech_fragments:")
    )
    assert "Every fragment must be in Malayalam" in fragments_rule
    assert "leave that phrase out even though they said it" in fragments_rule


# --- The two couplings that used to be able to drift silently -----------------
#
# Both failures below produce a COMPLETE session: a plausible transcript, a
# score, no error. The updater simply returns nothing for the affected field and
# the actor prompt renders its named absence. That is the same shape of
# invisible failure the coverage log in worker.py exists for, so these are
# pinned here rather than left to a code reviewer noticing a spelling.


def _template_placeholders() -> set:
    """Placeholder names in the shipped .txt, whatever it currently says."""
    import re

    from app.prompts.resolver import load_template

    return set(
        re.findall(r"\{([a-zA-Z_][a-zA-Z0-9_]*)\}", load_template(_TEMPLATE_PATH))
    )


def _kwargs_python_supplies() -> set:
    """Keyword names at the real call site, read from the AST rather than typed here.

    Parsed, not duplicated: a test that hardcodes the expected names passes
    just as happily when both sides are wrong together.
    """
    import ast
    import inspect

    from app.core.working_memory import consolidate

    tree = ast.parse(inspect.getsource(consolidate))
    for node in ast.walk(tree):
        if (
            isinstance(node, ast.Call)
            and getattr(node.func, "id", None) == "load_and_format"
            and node.args
            and getattr(node.args[0], "id", None) == "_TEMPLATE_PATH"
        ):
            return {kw.arg for kw in node.keywords if kw.arg}
    raise AssertionError("no load_and_format(_TEMPLATE_PATH, ...) call found")


def test_the_template_asks_for_exactly_the_values_python_supplies():
    """A placeholder Python does not pass renders EMPTY, not as an error.

    `SafeFormatter` resolves a key to "" when the prompt declares it, so
    renaming `{current_state}` in the body alone would hand the model
    "The client is at:" with nothing after it and no warning anywhere. The
    reverse — a kwarg no placeholder consumes — is just as quiet.
    """
    assert _template_placeholders() == _kwargs_python_supplies()


def test_every_field_the_template_names_exists_on_the_schema():
    """The prose and the structured-output schema are one contract.

    The model is bound to `ProposedUpdate`, so the bullets in the template are
    guidance and the SCHEMA is what it must fill. A bullet naming a field that
    the schema does not carry is an instruction the model cannot follow; a
    schema field no bullet explains is one it fills badly. `register` is the
    field this test was written for — it reaches the model by alias, and the
    attribute behind it is spelled differently.
    """
    import re

    from app.core.working_memory.proposal import ProposedUpdate
    from app.prompts.resolver import load_template

    body = load_template(_TEMPLATE_PATH)
    named = set()
    for line in body.splitlines():
        match = re.match(r"^- ([a-z_ /]+):", line)
        if match:
            named.update(part.strip() for part in match.group(1).split("/"))

    from app.core.livekit.delivery import ProposedDelivery

    # `delivery` is a nested object: its own fields are the bullets, under a
    # heading that names the object itself.
    schema_fields = set(ProposedUpdate.model_json_schema()["properties"])
    assert "delivery" in schema_fields
    assert "(delivery)" in body, "the delivery section must name its field"
    schema_fields = (schema_fields - {"delivery"}) | set(
        ProposedDelivery.model_json_schema()["properties"]
    )
    assert named, "no field bullets found — did the template's format change?"
    assert named == schema_fields


def test_the_model_is_asked_for_register_not_voice_register():
    """The name the updater and Main Agent Prompt #3 now share.

    Pinned explicitly because the attribute is still `voice_register` (it would
    shadow a `BaseModel` attribute otherwise), so nothing else in Python reads
    as a mistake if the alias is dropped.
    """
    from app.core.working_memory.proposal import ProposedUpdate

    assert "register" in ProposedUpdate.model_json_schema()["properties"]
    assert "voice_register" not in ProposedUpdate.model_json_schema()["properties"]
    # Still parsed if the model answers with the attribute name anyway.
    assert (
        ProposedUpdate.model_validate({"register": "clipped"}).voice_register
        == "clipped"
    )
    assert ProposedUpdate(voice_register="flat").voice_register == "flat"
