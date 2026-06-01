"""
Unit tests for `_get_selected_prompt_has_states`.

Behaviour gate: variant computes state guidance iff its body references
`{state_x_guidelines}` (body-driven, via auto-reconciled availableVariables),
with the legacy `hasStates` boolean kept as a backward-compat fallback.
"""

from types import SimpleNamespace

from app.core.graph.prompt import _get_selected_prompt_has_states


def _prompt_data(*, selected_code, prompts):
    """Tiny PromptData stand-in — the function only reads two attrs."""
    return SimpleNamespace(
        selected_main_prompt_code=selected_code,
        prompts=prompts,
    )


# ---- Body-driven path (preferred) ------------------------------------------


def test_returns_true_when_state_x_guidelines_in_available_variables_strings():
    """availableVariables as list[str] — placeholder reference wins, even
    when hasStates is false / missing."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": ["name", "state_x_guidelines", "samples"],
                "hasStates": False,  # ignored — body-reference wins
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is True


def test_returns_true_when_state_x_guidelines_in_available_variables_dicts():
    """availableVariables as list[dict] — the chip-metadata schema."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": [
                    {"name": "name", "label": "Name", "required": True},
                    {"name": "state_x_guidelines", "label": "Active State Guidelines"},
                ],
                "hasStates": False,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is True


def test_returns_false_when_body_does_not_reference_placeholder_and_hasstates_false():
    """Negative case: placeholder absent + hasStates explicitly false."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": ["name", "age", "samples"],
                "hasStates": False,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is False


# ---- Legacy fallback (backward compat) -------------------------------------


def test_returns_true_when_only_hasstates_flag_set_legacy_row():
    """Row authored before auto-reconcile: availableVariables doesn't
    include state_x_guidelines but hasStates=true. Honor the legacy
    signal so existing scenarios keep working."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": ["name", "age"],  # legacy / stale
                "hasStates": True,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is True


def test_returns_true_when_hasstates_true_and_no_available_variables():
    """Some rows may have empty / null availableVariables; hasStates
    is still authoritative for them."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": None,
                "hasStates": True,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is True


# ---- Missing / malformed input ---------------------------------------------


def test_returns_false_when_no_variant_selected():
    data = _prompt_data(selected_code=None, prompts={"v1": {"hasStates": True}})
    assert _get_selected_prompt_has_states(data) is False


def test_returns_false_when_prompts_dict_missing():
    data = _prompt_data(selected_code="v1", prompts=None)
    assert _get_selected_prompt_has_states(data) is False


def test_returns_false_when_selected_code_not_in_prompts():
    data = _prompt_data(
        selected_code="missing",
        prompts={"v1": {"hasStates": True}},
    )
    assert _get_selected_prompt_has_states(data) is False


def test_returns_false_when_entry_is_not_a_dict():
    data = _prompt_data(selected_code="v1", prompts={"v1": "not-a-dict"})
    assert _get_selected_prompt_has_states(data) is False
