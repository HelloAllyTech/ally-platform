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
