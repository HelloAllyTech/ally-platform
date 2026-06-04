"""Unit tests for opening-statement / auto-start gating in the agent factory.

Opening statements are optional. When a scenario has none, the agent should
open the conversation itself via an LLM-generated turn instead of staying
silent — `should_auto_start_conversation` gates that behaviour and is mutually
exclusive with `should_say_opening_statement`.
"""

from types import SimpleNamespace

from app.core.agent.factory import (
    should_auto_start_conversation,
    should_say_opening_statement,
)


def _orchestrator(terminating: bool = False):
    return SimpleNamespace(is_termination_initiated=lambda: terminating)


def _scenario(opening_statements):
    """A minimal scenario stand-in; only prompt_data.opening_statements is read."""
    return SimpleNamespace(
        prompt_data=SimpleNamespace(opening_statements=opening_statements)
    )


class TestShouldAutoStartConversation:
    def test_auto_starts_when_opening_statements_empty(self):
        scenario = _scenario([])
        assert should_auto_start_conversation(scenario, _orchestrator()) is True
        # Mutually exclusive: nothing to say, so say-path must be False.
        assert should_say_opening_statement(scenario, _orchestrator()) is False

    def test_auto_starts_when_opening_statements_none(self):
        assert should_auto_start_conversation(_scenario(None), _orchestrator()) is True

    def test_auto_starts_when_prompt_data_missing(self):
        scenario = SimpleNamespace(prompt_data=None)
        assert should_auto_start_conversation(scenario, _orchestrator()) is True

    def test_does_not_auto_start_when_opening_statements_present(self):
        scenario = _scenario(["Hi, thanks for seeing me."])
        assert should_auto_start_conversation(scenario, _orchestrator()) is False
        # The scripted say-path wins when statements exist.
        assert should_say_opening_statement(scenario, _orchestrator()) is True

    def test_does_not_auto_start_when_terminating(self):
        scenario = _scenario([])
        assert (
            should_auto_start_conversation(scenario, _orchestrator(terminating=True))
            is False
        )

    def test_does_not_auto_start_when_scenario_missing(self):
        assert should_auto_start_conversation(None, _orchestrator()) is False
