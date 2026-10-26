import logging
from unittest.mock import patch

from app.prompts import contracts
from app.prompts.resolver import (
    _extract_allowed_variables,
    load_and_format,
    resolve_template,
)


@patch("app.prompts.resolver.prompt_manager")
def test_resolve_template_supervisor_note_uses_store_text_when_present(
    mock_prompt_manager,
):
    """The Skills Store is the source of truth for the debrief note too: its
    live text wins, and the local default is only the fallback."""
    prompt_code = "ally_ai_shared_supervisor_note"
    internal_path = "shared/supervisor_note"
    mock_prompt_manager.get_template.return_value = "Local default."

    result = resolve_template(
        prompt_code, {prompt_code: "Live store text."}, internal_path=internal_path
    )
    assert result == "Live store text."

    assert (
        resolve_template(prompt_code, backend_prompts=None, internal_path=internal_path)
        == "Local default."
    )


@patch("app.prompts.resolver.prompt_manager")
def test_resolve_template_prefers_backend_then_local(mock_prompt_manager):
    mock_prompt_manager.get_template.return_value = "Local."
    code = "ally_ai_some_other_prompt"
    assert (
        resolve_template(code, {code: "Backend."}, internal_path="some/other_prompt")
        == "Backend."
    )
    assert resolve_template(code, {}, internal_path="some/other_prompt") == "Local."


def test_allowed_variables_accept_object_entries():
    """ally-be sends `{name, label?, required?}` objects; reading only strings
    left the allowed set empty, so every placeholder rendered as literal text."""
    entry = {"availableVariables": ["legacy", {"name": "modern", "required": True}]}
    assert _extract_allowed_variables(entry) == {"legacy", "modern"}


def test_load_and_format_fills_object_declared_variables():
    code = "ally_ai_nudge_nudge"
    prompts = {
        code: {
            "prompt": "Hello {name}, {missing}.",
            "availableVariables": [{"name": "name"}, {"name": "missing"}],
        }
    }
    assert load_and_format("nudge/nudge", prompts=prompts, name="Asha") == (
        "Hello Asha, ."
    )


def test_load_and_format_reads_the_store_text_from_prompt_data():
    code = "ally_ai_nudge_nudge"

    class PromptData:
        prompts = {code: {"prompt": "From the store: {name}."}}

    assert load_and_format("nudge/nudge", PromptData(), name="Asha") == (
        "From the store: Asha."
    )


def test_missing_required_variable_is_logged_but_still_renders(monkeypatch, caplog):
    code = "ally_ai_nudge_nudge"

    class Required(contracts.PromptInputs):
        name: str

    monkeypatch.setitem(contracts.PROMPT_CONTRACTS, code, Required)
    prompts = {code: {"prompt": "Hello {name}."}}
    with caplog.at_level(logging.ERROR):
        result = load_and_format("nudge/nudge", prompts=prompts)
    assert result == "Hello ."
    assert "[PROMPT_CONTRACT]" in caplog.text
    assert "name" in caplog.text


@patch("app.prompts.resolver.prompt_manager")
def test_logs_the_store_version_it_renders(mock_prompt_manager, caplog):
    prompts = {"ally_ai_nudge_nudge": {"prompt": "From the store.", "version": 7}}
    with caplog.at_level(logging.INFO):
        assert resolve_template("ally_ai_nudge_nudge", prompts) == "From the store."
    assert "[PROMPT_SOURCE] ally_ai_nudge_nudge: using store v7, len=15" in (
        caplog.text
    )
    mock_prompt_manager.get_template.assert_not_called()


@patch("app.prompts.resolver.prompt_manager")
def test_logs_a_fallback_to_the_local_default(mock_prompt_manager, caplog):
    mock_prompt_manager.get_template.return_value = "Local default."
    with caplog.at_level(logging.INFO):
        assert (
            resolve_template("ally_ai_nudge_nudge", {}, internal_path="nudge/nudge")
            == "Local default."
        )
    assert "[PROMPT_SOURCE] ally_ai_nudge_nudge: using fallback" in caplog.text
    assert any(
        r.levelno == logging.WARNING and "PROMPT_SOURCE" in r.getMessage()
        for r in caplog.records
    )
