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
    def test_placeholder_is_the_opt_in(self):
        assert prompt_declares_client_working_memory(_pd("client_working_memory"))

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
                        {"name": "client_working_memory", "required": False}
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
        # The block renders the active state's guidelines as its authored half,
        # so declaring the block asks for state resolution. Without this a
        # variant that swapped the placeholder for the block would lose its
        # state guidance AND its per-state RAG gating, silently.
        assert _get_selected_prompt_has_states(_pd("client_working_memory"))

    def test_neither_placeholder_resolves_nothing(self):
        assert not _get_selected_prompt_has_states(_pd("language_glossary"))


class TestBlockRendering:
    """_build_behavior_prompt's handling of the block, via the real builder."""

    def _build(self, prompt_data, memory, states=None, score=0):
        from app.core.graph.prompt import _build_behavior_prompt

        prompt_data.states = states or []
        for attr in (
            "title",
            "description",
            "role_instructions",
            "name",
            "age",
            "gender",
        ):
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

    def test_opted_out_prompt_gets_no_block(self):
        memory = ClientWorkingMemory(affect="wary", disclosed=[Fact(text="a fact")])
        content = self._build(_pd("state_x_guidelines"), memory)
        assert "a fact" not in content

    def test_no_memory_renders_nothing(self):
        content = self._build(_pd("client_working_memory"), None)
        assert "{client_working_memory}" not in content

    def test_opted_in_prompt_gets_the_derived_state(self):
        memory = ClientWorkingMemory(
            affect="wary",
            disclosed=[Fact(text="lost the job in March")],
        )
        content = self._build(_pd("client_working_memory"), memory)
        assert "lost the job in March" in content

    def test_withheld_topic_reaches_the_prompt_without_its_content(self):
        memory = ClientWorkingMemory(
            affect="tense",
            withheld=[
                WithheldTopic(
                    topic="the hospital visit", deflection="asks about work instead"
                )
            ],
        )
        content = self._build(_pd("client_working_memory"), memory)
        assert "the hospital visit" in content
        assert "asks about work instead" in content

    def test_appraisal_is_never_rendered(self):
        memory = ClientWorkingMemory(
            affect="wary", appraisal="they are just ticking boxes"
        )
        content = self._build(_pd("client_working_memory"), memory)
        assert "ticking boxes" not in content

    def test_authored_guidance_renders_once_not_twice(self):
        # A variant mid-migration may declare BOTH placeholders. The same
        # instruction rendered twice reads as emphasis, not duplication.
        states = [
            {
                "name": "opening",
                "scoreLower": 0,
                "scoreUpper": 10,
                "guidelines": "STAY GUARDED AND BRIEF",
            }
        ]
        memory = ClientWorkingMemory(affect="wary")
        content = self._build(
            _pd("client_working_memory", "state_x_guidelines"), memory, states=states
        )
        assert content.count("STAY GUARDED AND BRIEF") == 1

    def test_the_block_lands_where_the_author_put_the_placeholder(self):
        # The point of a placeholder over a suffix append (§2.3): position is a
        # variable we intend to test, and only the author can move it.
        memory = ClientWorkingMemory(disclosed=[Fact(text="a distinctive fact")])
        content = self._build(_pd("client_working_memory"), memory)
        top = content.index("MARKER_TOP")
        bottom = content.index("MARKER_BOTTOM")
        assert top < content.index("a distinctive fact") < bottom

    def test_authored_guidance_reaches_the_block(self):
        states = [
            {
                "name": "opening",
                "scoreLower": 0,
                "scoreUpper": 10,
                "guidelines": "STAY GUARDED AND BRIEF",
            }
        ]
        content = self._build(
            _pd("client_working_memory"), ClientWorkingMemory(), states=states
        )
        assert "STAY GUARDED AND BRIEF" in content


class TestStateWarningScope:
    """The misconfiguration warning must not fire for a valid configuration."""

    def _build(self, prompt_data, states):
        from app.core.graph.prompt import _build_behavior_prompt

        prompt_data.states = states
        for attr in (
            "title",
            "description",
            "role_instructions",
            "name",
            "age",
            "gender",
        ):
            if not hasattr(prompt_data, attr):
                setattr(prompt_data, attr, "")
        return _build_behavior_prompt(
            prompt_data,
            [],
            None,
            None,
            None,
            current_score=0,
            client_working_memory=ClientWorkingMemory(affect="wary"),
        )

    def test_no_warning_when_only_the_block_is_declared(self, caplog):
        # Generalising the states gate made this fire every turn for a valid
        # setup: the block names the absence, so no states is not an error.
        import logging

        with caplog.at_level(logging.WARNING):
            self._build(_pd("client_working_memory"), [])
        assert "no active state resolved" not in caplog.text

    def test_warning_still_fires_for_a_states_prompt_with_no_states(self, caplog):
        # The real misconfiguration must still be visible.
        import logging

        with caplog.at_level(logging.WARNING):
            self._build(_pd("state_x_guidelines"), [])
        assert "no active state resolved" in caplog.text


#: The split form. Same store, same consolidation — the memory is exposed as
#: one placeholder per section so a curator can read what is being fed and can
#: move, reorder or drop a section to experiment.
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

    Reuses `TestBlockRendering`'s harness rather than inheriting its CASES:
    subclassing would have re-run every block-form assertion against the
    block-form body, which looks like extra coverage and is the same test
    twice.
    """

    _build = TestBlockRendering._build

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

    def test_declaring_both_forms_renders_the_block_and_leaves_sections_bare(self):
        # The tie is broken toward the block because the block is what runs in
        # production: a working prompt must not change behaviour because
        # someone pasted a section in to try it. The bare heading is the
        # visible symptom; a silently swapped renderer would not be.
        body = _SPLIT_BODY + "\n{client_working_memory}\n"
        content = self._build(
            _pd(*_SPLIT_VARS, "client_working_memory", body=body),
            ClientWorkingMemory(disclosed=[Fact(text="a distinctive fact")]),
        )
        assert content.count("a distinctive fact") == 1

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
        # The block form never showed this because render_block substituted the
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
