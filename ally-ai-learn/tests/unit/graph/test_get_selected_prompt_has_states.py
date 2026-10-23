"""
Unit tests for `_get_selected_prompt_has_states`.

Behaviour gate: variant computes state guidance iff its body references
`{state_x_guidelines}` (body-driven, via auto-reconciled availableVariables).
The legacy `hasStates` boolean is no longer consulted — the
BackfillAvailableVariables1780150000000 migration populates the list for
every row from its latest body, so the list is the single source of truth.
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


# ---- hasStates is ignored (post-backfill) ---------------------------------


def test_returns_false_when_reconciled_list_lacks_placeholder_even_if_hasstates_true():
    """Critical case: duplicated main_agent variants have hasStates=true
    forced at duplicate time. After the admin edits the body to remove
    {state_x_guidelines} and saves, availableVariables is reconciled
    without the placeholder — and the gate MUST return false. hasStates
    is no longer consulted."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": ["name", "age", "samples"],
                "hasStates": True,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is False


def test_returns_false_when_empty_list_even_if_hasstates_true():
    """Post-backfill, an empty availableVariables list means the body
    has zero placeholder references — no states regardless of the legacy
    hasStates flag. (Pre-backfill this fell through to hasStates; the
    migration populated every row's list so the fallback was removed.)"""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": [],
                "hasStates": True,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is False


def test_returns_false_when_missing_list_even_if_hasstates_true():
    """Same as empty list — missing/None list does not fall through to
    hasStates after the backfill migration. Any row reaching this code
    path with no list is treated as having no placeholder references."""
    data = _prompt_data(
        selected_code="v1",
        prompts={
            "v1": {
                "availableVariables": None,
                "hasStates": True,
            },
        },
    )
    assert _get_selected_prompt_has_states(data) is False


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
