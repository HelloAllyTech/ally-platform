"""The resolver checks each render against the prompt's typed contract."""

import logging

from app.prompts import contracts
from app.prompts.resolver import load_and_format, load_and_format_by_code

CODE = "ally_ai_learn_supervisor_live_note"


class _PromptData:
    def __init__(self, prompts):
        self.prompts = prompts


def test_required_variable_not_supplied_is_an_error_but_still_renders(caplog):
    data = _PromptData({CODE: {"prompt": "Write in {LANGUAGE}."}})
    with caplog.at_level(logging.ERROR):
        out = load_and_format("supervisor/live_note", data)
    assert out == "Write in ."
    assert "[PROMPT_CONTRACT]" in caplog.text
    assert "LANGUAGE" in caplog.text


def test_required_variable_supplied_logs_no_contract_error(caplog):
    data = _PromptData({CODE: {"prompt": "Write in {LANGUAGE}."}})
    with caplog.at_level(logging.ERROR):
        out = load_and_format("supervisor/live_note", data, LANGUAGE="Hindi")
    assert out == "Write in Hindi."
    assert "[PROMPT_CONTRACT]" not in caplog.text


def test_contract_comes_from_code_not_the_backend_entry(caplog, monkeypatch):
    """A backend entry marking a variable required does not create a contract:
    the contract is the in-code model."""
    monkeypatch.setitem(
        contracts.PROMPT_CONTRACTS, CODE, contracts.PromptInputs
    )  # no required fields
    data = _PromptData(
        {
            CODE: {
                "prompt": "Write in {LANGUAGE}.",
                "availableVariables": [{"name": "LANGUAGE", "required": True}],
            }
        }
    )
    with caplog.at_level(logging.ERROR):
        load_and_format("supervisor/live_note", data)
    assert "[PROMPT_CONTRACT]" not in caplog.text


def test_unresolved_variant_falls_back_loudly(caplog):
    data = _PromptData(
        {"ally_ai_learn_system_main_agent_prompt": {"prompt": "Default {name}."}}
    )
    with caplog.at_level(logging.ERROR):
        out = load_and_format_by_code(
            "ally_ai_learn_system_missing_variant",
            data,
            fallback_internal_path="system/main_agent_prompt",
            name="Asha",
        )
    assert out == "Default Asha."
    assert "[PROMPT_FALLBACK]" in caplog.text
    assert "ally_ai_learn_system_missing_variant" in caplog.text


def test_backend_prompts_accepts_a_whole_prompt_data_dict():
    """Events can hold the session's promptData as a plain dict; its
    ``prompts`` map is what the resolver must read, not the dict itself."""
    from app.prompts.resolver import _get_backend_prompts

    prompts = {"ally_ai_learn_events_guardrail_user": {"prompt": "x"}}
    assert _get_backend_prompts({"title": "t", "prompts": prompts}) is prompts
    assert _get_backend_prompts(prompts) is prompts
