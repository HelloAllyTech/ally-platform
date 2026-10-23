"""Tests for the read path: how the block reaches the prompt.

The claims being defended:

- the opt-in IS the placeholder — no flag, no registry, no migration;
- declaring the block also opts into state resolution, or a variant that drops
  {state_x_guidelines} in its favour would silently lose its state guidance;
- the authored guidance is rendered once, never twice;
- position is the author's, because the block is substituted rather than
  appended.
"""

from types import SimpleNamespace

import pytest

from app.core.graph.prompt import (
    _get_selected_prompt_has_states,
    prompt_declares_client_working_memory,
)
from app.core.working_memory.state import ClientWorkingMemory, Fact, WithheldTopic

pytestmark = pytest.mark.unit


#: A stand-in for the dashboard-authored variant. The real one is written in
#: prompt management (variants live in backend metadata, not as local files),
#: so a body is supplied here the way ally-be would send it. The marker lines
#: let a test assert POSITION, not merely presence.
_BODY = """You are {name}.
MARKER_TOP
{client_working_memory}
MARKER_BOTTOM
{state_x_guidelines}
"""


def _pd(*variables, code="code_x", body=_BODY):
    return SimpleNamespace(
        selected_main_prompt_code=code,
        prompts={
            code: {"prompt": body, "availableVariables": list(variables)},
        },
    )


class TestOptIn:
    def test_a_section_placeholder_is_the_opt_in(self):
        assert prompt_declares_client_working_memory(_pd("working_memory_stance"))

    def test_the_retired_block_placeholder_no_longer_opts_in(self):
        # `{client_working_memory}` used to be the opt-in and is now inert. A
        # prompt still carrying it gets NO working memory, which is the visible
        # symptom telling a curator to move to the `working_memory_*` sections.
        assert not prompt_declares_client_working_memory(_pd("client_working_memory"))

    def test_absent_placeholder_is_opted_out(self):
        assert not prompt_declares_client_working_memory(_pd("state_x_guidelines"))

    def test_no_selected_variant_is_opted_out(self):
        assert not prompt_declares_client_working_memory(
            SimpleNamespace(selected_main_prompt_code=None, prompts={})
        )

    def test_object_schema_variables_are_read(self):
        # ally-be stores either string[] or {name,label,required}[].
        pd = SimpleNamespace(
            selected_main_prompt_code="c",
            prompts={
                "c": {
                    "availableVariables": [
                        {"name": "working_memory_stance", "required": False}
                    ]
                }
            },
        )
        assert prompt_declares_client_working_memory(pd)

    def test_malformed_entry_does_not_raise(self):
        pd = SimpleNamespace(
            selected_main_prompt_code="c", prompts={"c": {"availableVariables": None}}
        )
        assert not prompt_declares_client_working_memory(pd)


class TestStateGateGeneralization:
    def test_states_placeholder_still_resolves_states(self):
        assert _get_selected_prompt_has_states(_pd("state_x_guidelines"))

    def test_working_memory_placeholder_also_resolves_states(self):
        # Resolution gates per-state RAG as well as guidance, so a working
        # memory prompt must resolve states even though this module does not
        # render the guidance itself. Otherwise a scenario keeps its knowledge
        # sources on in states the author switched them off — silently.
        assert _get_selected_prompt_has_states(_pd("working_memory_stance"))

    def test_neither_placeholder_resolves_nothing(self):
        assert not _get_selected_prompt_has_states(_pd("language_glossary"))


def _build_content(prompt_data, memory, states=None, score=0):
    """Render a prompt through the real builder.

    Module-level rather than a method because two test classes need it and
    neither owns it: it used to hang off the block-form class, which is gone.
    """
    from app.core.graph.prompt import _build_behavior_prompt

    prompt_data.states = states or []
    for attr in ("title", "description", "role_instructions", "name", "age", "gender"):
        if not hasattr(prompt_data, attr):
            setattr(prompt_data, attr, "")
    msg, _ = _build_behavior_prompt(
        prompt_data,
        [],
        None,
        None,
        None,
        current_score=score,
        client_working_memory=memory,
    )
    return msg.content


class TestRetiredBlockPlaceholder:
    """`{client_working_memory}` is gone. What matters is how it fails."""

    def _build(self, prompt_data, memory, states=None):
        return _build_content(prompt_data, memory, states=states)

    def test_the_retired_placeholder_renders_away_rather_than_leaking(self):
        # Passed as "" forever (see prompt.py). If the kwarg were dropped the
        # SafeFormatter would leave the literal `{client_working_memory}` in the
        # actor's prompt, which is worse than rendering nothing.
        content = self._build(_pd("client_working_memory"), None)
        assert "{client_working_memory}" not in content

    def test_a_prompt_declaring_only_the_retired_placeholder_gets_no_memory(self):
        memory = ClientWorkingMemory(
            affect="wary", disclosed=[Fact(text="lost the job in March")]
        )
        content = self._build(_pd("client_working_memory"), memory)
        assert "lost the job in March" not in content

    def test_an_opted_out_prompt_gets_nothing(self):
        memory = ClientWorkingMemory(affect="wary", disclosed=[Fact(text="a fact")])
        content = self._build(_pd("state_x_guidelines"), memory)
        assert "a fact" not in content


_SPLIT_BODY = """You are {name}.
GUIDANCE_HERE
{state_x_guidelines}
MARKER_TOP
{working_memory_stance}
{working_memory_register}
{working_memory_speech_fragments}
{working_memory_withheld}
{working_memory_unresolved}
{working_memory_disclosed}
{working_memory_salient}
MARKER_BOTTOM
"""

_SPLIT_VARS = (
    "state_x_guidelines",
    "working_memory_stance",
    "working_memory_register",
    "working_memory_speech_fragments",
    "working_memory_withheld",
    "working_memory_unresolved",
    "working_memory_disclosed",
    "working_memory_salient",
)

_STATES = [
    {
        "name": "opening",
        "scoreLower": 0,
        "scoreUpper": 10,
        "guidelines": "STAY GUARDED AND BRIEF",
    }
]


class TestSplitForm:
    """The split form, built through the same real builder.

    Uses the shared `_build_content` harness rather than inheriting cases from
    another class: subclassing would re-run one form's assertions against the
    other form's body, which looks like extra coverage and is the same test
    twice.
    """

    def _build(self, prompt_data, memory, states=None, score=0):
        return _build_content(prompt_data, memory, states=states, score=score)

    def _split(self, *variables, memory=None, states=None):
        return self._build(
            _pd(*(variables or _SPLIT_VARS), body=_SPLIT_BODY),
            memory if memory is not None else ClientWorkingMemory(),
            states=states,
        )

    def test_section_placeholders_are_an_opt_in(self):
        # The opt-in is still the placeholder — there is just more than one
        # spelling of it now.
        assert prompt_declares_client_working_memory(
            _pd("working_memory_disclosed", body=_SPLIT_BODY)
        )

    def test_a_single_section_opts_in(self):
        # ANY, not ALL. Requiring all seven would turn a curator dropping one
        # section into a silent, total opt-OUT.
        assert prompt_declares_client_working_memory(
            _pd("working_memory_salient", body=_SPLIT_BODY)
        )

    def test_the_split_form_leaves_the_authored_guidance_visible(self):
        # THE reason this form exists. The block form folds state guidance in
        # and blanks `{state_x_guidelines}`, so a designer opening the prompt
        # could not see their own words in it and read the absence as deletion.
        content = self._split(memory=ClientWorkingMemory(affect="wary"), states=_STATES)

        assert "STAY GUARDED AND BRIEF" in content
        assert content.count("STAY GUARDED AND BRIEF") == 1
        assert content.index("GUIDANCE_HERE") < content.index("STAY GUARDED AND BRIEF")

    def test_sections_land_where_the_author_put_them(self):
        content = self._split(
            memory=ClientWorkingMemory(
                affect="wary", disclosed=[Fact(text="a distinctive fact")]
            )
        )
        assert (
            content.index("MARKER_TOP")
            < content.index("a distinctive fact")
            < content.index("MARKER_BOTTOM")
        )

    def test_an_undeclared_section_simply_does_not_render(self):
        # Dropping a section is the FEATURE. What must not happen is the rest
        # of the memory disappearing with it.
        content = self._split(
            "working_memory_disclosed",
            memory=ClientWorkingMemory(
                affect="wary",
                disclosed=[Fact(text="a distinctive fact")],
                withheld=[WithheldTopic(topic="the diagnosis", deflection="deflect")],
            ),
        )
        assert "a distinctive fact" in content
        assert "{working_memory_withheld}" not in content

    def test_the_split_form_resolves_states_even_without_the_guidance_field(self):
        # Resolution gates RAG, not just guidance. A split prompt that skipped
        # it would keep knowledge sources on in states an author turned them
        # off — a per-state retrieval leak with no visible symptom.
        assert _get_selected_prompt_has_states(
            _pd("working_memory_stance", body=_SPLIT_BODY)
        )

    def test_an_unresolved_state_still_names_its_absence(self):
        # Seen in prod on a live session: the score climbed past the last
        # configured band, no state resolved, and `{state_x_guidelines}` went
        # in empty — leaving "## What this conversation is meant to be doing"
        # with nothing under it.
        #
        # The retired block renderer hid this by substituting the
        # named absence on the way through. The split form routes the authored
        # half around that module, so the caller has to do it. A bare heading
        # reads as an absence of CONSTRAINT, not of data, and this is the
        # heading that tells the actor what the conversation is FOR.
        from app.core.working_memory.render import NO_STATE_GUIDANCE

        content = self._split(memory=ClientWorkingMemory(affect="wary"), states=[])

        assert NO_STATE_GUIDANCE in content
        assert "GUIDANCE_HERE\n\n" not in content

    def test_a_resolved_state_is_not_replaced_by_the_absence(self):
        from app.core.working_memory.render import NO_STATE_GUIDANCE

        content = self._split(memory=ClientWorkingMemory(affect="wary"), states=_STATES)

        assert "STAY GUARDED AND BRIEF" in content
        assert NO_STATE_GUIDANCE not in content

    def test_the_stance_mirrors_the_authored_state(self):
        # Working memory does not choose the state any more; it labels the one
        # the author's score bands resolved to. Two controllers for one
        # behaviour is what made a scenario unable to move through its own
        # bands until the ladder agreed.
        four = [
            {
                "name": "dis-engaged",
                "scoreLower": -100,
                "scoreUpper": 0,
                "guidelines": "GUARDED_TEXT",
            },
            {
                "name": "heard",
                "scoreLower": 0,
                "scoreUpper": 50,
                "guidelines": "HEARD_TEXT",
            },
        ]
        memory = ClientWorkingMemory(stance="dis-engaged", affect="wary")
        content = self._split(memory=memory, states=four)

        # score 0 resolves "heard"; the stance follows it rather than pinning
        # the prompt to where the ladder had got to
        assert "HEARD_TEXT" in content
        assert memory.stance == "heard"
        assert "You are heard right now" in content

    def test_the_authored_state_wins_even_when_the_ladder_disagrees(self):
        # The regression that matters: a stance further along than the author's
        # resolved band must not hold the prompt back.
        two = [
            {
                "name": "early",
                "scoreLower": 0,
                "scoreUpper": 50,
                "guidelines": "EARLY_TEXT",
            },
            {
                "name": "late",
                "scoreLower": 50,
                "scoreUpper": 999,
                "guidelines": "LATE_TEXT",
            },
        ]
        memory = ClientWorkingMemory(stance="late", affect="wary")
        content = self._split(memory=memory, states=two)

        assert "EARLY_TEXT" in content
        assert "LATE_TEXT" not in content

    def test_a_non_working_memory_prompt_keeps_score_selection(self):
        # The blast radius. Every scenario that did not opt in must be
        # untouched, which is what makes this safe to ship without migrating
        # the library.
        states = [
            {"name": "low", "scoreLower": 0, "scoreUpper": 50, "guidelines": "LOW"},
            {"name": "high", "scoreLower": 50, "scoreUpper": 999, "guidelines": "HIGH"},
        ]
        content = self._build(_pd("state_x_guidelines"), None, states=states, score=0)
        assert "LOW" in content
