"""
Unit tests for `_resolve_simulation_state_by_score` boundary semantics.

The resolver is the runtime contract for which state's guidelines flow
into `{state_x_guidelines}` per turn. Boundary behavior (inclusive lower,
exclusive upper) is easy to get wrong and was previously untested.
"""

from app.core.graph.prompt import _resolve_simulation_state_by_score


def _state(
    name: str,
    *,
    lower=None,
    upper=None,
    is_starting: bool = False,
    rag_enabled: bool = True,
):
    return {
        "id": f"state_{name}",
        "name": name,
        "guidelines": f"{name} guidelines",
        "isStarting": is_starting,
        "scoreLower": lower,
        "scoreUpper": upper,
        "ragEnabled": rag_enabled,
    }


# ---- Inclusive-lower / exclusive-upper contract ----------------------------


def test_score_equal_to_upper_bound_matches_next_state():
    """At score=50, with ranges [null,50) and [50,null), the SECOND state wins.

    scoreUpper is exclusive: the first state ends BEFORE 50. The second
    state starts AT 50 (inclusive). This is the canonical boundary case
    that produced the original "open lower bound" validation error when
    the deterministic ranges started at 0 instead of MIN_STATE_GAP.
    """
    states = [
        _state("Early", lower=None, upper=50, is_starting=True),
        _state("Late", lower=50, upper=None),
    ]
    result = _resolve_simulation_state_by_score(states, 50)
    assert result is not None
    assert result["name"] == "Late"


def test_score_one_below_upper_matches_first_state():
    states = [
        _state("Early", lower=None, upper=50, is_starting=True),
        _state("Late", lower=50, upper=None),
    ]
    result = _resolve_simulation_state_by_score(states, 49)
    assert result is not None
    assert result["name"] == "Early"


def test_score_equal_to_lower_bound_matches_that_state():
    """Inclusive lower: at score equal to the lower bound, the state is active."""
    states = [
        _state("Early", lower=None, upper=50, is_starting=True),
        _state("Middle", lower=50, upper=100),
        _state("Late", lower=100, upper=None),
    ]
    result = _resolve_simulation_state_by_score(states, 50)
    assert result is not None
    assert result["name"] == "Middle"


# ---- Open-bound edges ------------------------------------------------------


def test_score_below_lowest_finite_bound_matches_first_open_state():
    states = [
        _state("Early", lower=None, upper=50, is_starting=True),
        _state("Late", lower=50, upper=None),
    ]
    # Anything below 50 falls in the first state's open-lower range.
    assert _resolve_simulation_state_by_score(states, -10000)["name"] == "Early"
    assert _resolve_simulation_state_by_score(states, 0)["name"] == "Early"
    assert _resolve_simulation_state_by_score(states, 49)["name"] == "Early"


def test_score_above_highest_finite_bound_matches_last_open_state():
    states = [
        _state("Early", lower=None, upper=50, is_starting=True),
        _state("Late", lower=50, upper=None),
    ]
    assert _resolve_simulation_state_by_score(states, 99999)["name"] == "Late"


def test_single_state_with_both_bounds_open_always_matches():
    states = [_state("Only", lower=None, upper=None, is_starting=True)]
    assert _resolve_simulation_state_by_score(states, -100)["name"] == "Only"
    assert _resolve_simulation_state_by_score(states, 0)["name"] == "Only"
    assert _resolve_simulation_state_by_score(states, 1_000_000)["name"] == "Only"


# ---- Turn-1 / no-score fallback ---------------------------------------------
# current_score is None only on dev/test paths with no ScoreKeeper wired up.
# The starting state is emergent: None is treated as score 0, so it resolves
# to the state whose range contains 0 — exactly as turn 1 would in production.


def test_none_score_resolves_as_score_zero():
    states = [
        _state("Early", lower=None, upper=50),
        _state("Middle", lower=50, upper=100),
        _state("Late", lower=100, upper=None),
    ]
    # None → treated as 0 → "Early" (the 0-containing state), and identical
    # to passing 0 explicitly.
    by_none = _resolve_simulation_state_by_score(states, None)
    by_zero = _resolve_simulation_state_by_score(states, 0)
    assert by_none is not None
    assert by_none["name"] == "Early"
    assert by_none == by_zero


def test_none_score_clamps_to_first_when_zero_below_range():
    """If 0 sits below the first state's lower bound, None (=0) clamps to
    the first state — the same clamp any below-range score gets."""
    states = [
        _state("Mid", lower=50, upper=100),
        _state("High", lower=100, upper=200),
    ]
    result = _resolve_simulation_state_by_score(states, None)
    assert result is not None
    assert result["name"] == "Mid"


# ---- No-states / no-match cases --------------------------------------------


def test_empty_states_returns_none():
    assert _resolve_simulation_state_by_score([], 0) is None
    assert _resolve_simulation_state_by_score(None, 0) is None
    assert _resolve_simulation_state_by_score([], None) is None


def test_score_in_gap_between_non_contiguous_ranges_returns_none():
    """If ranges are non-contiguous (validation bypass / DB corruption),
    a score in the gap returns None so the caller renders empty guidance
    rather than picking an arbitrary state."""
    states = [
        _state("Early", lower=None, upper=20),
        _state("Late", lower=80, upper=None),
    ]
    # Score 50 is in the gap [20, 80) — neither state matches.
    result = _resolve_simulation_state_by_score(states, 50)
    assert result is None


# ---- First-match-wins on overlapping ranges --------------------------------


def test_overlapping_ranges_returns_first_in_array_order():
    """Validation rejects overlaps, but if a malformed payload gets through
    the resolver must be deterministic. It picks the first match in the
    array's original order."""
    states = [
        _state("First", lower=None, upper=100),
        _state("Second", lower=50, upper=None),
    ]
    # Score 75 matches both; first-in-array wins.
    result = _resolve_simulation_state_by_score(states, 75)
    assert result is not None
    assert result["name"] == "First"


# ---- Strict-bounds clamp fallback ------------------------------------------
# As of the strict-bounds migration, every state has finite numeric bounds
# (no more "open" ends). Out-of-range scores must clamp to the nearest
# end-state so {state_x_guidelines} always renders something meaningful.


def test_score_below_first_lower_clamps_to_first_state():
    """Strict-bounds: score < first.scoreLower → first state."""
    states = [
        _state("First", lower=0, upper=50),
        _state("Second", lower=50, upper=100),
        _state("Third", lower=100, upper=150),
    ]
    # Score -10 is below every interval; clamp to "First".
    result = _resolve_simulation_state_by_score(states, -10)
    assert result is not None
    assert result["name"] == "First"


def test_score_above_last_upper_clamps_to_last_state():
    """Strict-bounds: score >= last.scoreUpper → last state."""
    states = [
        _state("First", lower=0, upper=50),
        _state("Second", lower=50, upper=100),
        _state("Third", lower=100, upper=150),
    ]
    # Score 9999 is way past every upper; clamp to "Third".
    result = _resolve_simulation_state_by_score(states, 9999)
    assert result is not None
    assert result["name"] == "Third"


def test_score_exactly_at_last_upper_clamps_to_last_state():
    """Boundary: score = last.scoreUpper isn't a strict match (upper is
    exclusive) but the clamp catches it and returns the last state."""
    states = [
        _state("First", lower=0, upper=50),
        _state("Second", lower=50, upper=100),
    ]
    result = _resolve_simulation_state_by_score(states, 100)
    assert result is not None
    assert result["name"] == "Second"


def test_clamp_uses_score_order_not_array_order():
    """Clamp resolves based on numeric ordering of bounds, regardless of
    how the admin's states array is ordered in storage."""
    states = [
        # Author saved them in random order.
        _state("Middle", lower=50, upper=100),
        _state("Last", lower=100, upper=150),
        _state("First", lower=0, upper=50),
    ]
    # Below all bounds → "First" (lowest lower).
    assert _resolve_simulation_state_by_score(states, -5)["name"] == "First"
    # Above all bounds → "Last" (highest upper).
    assert _resolve_simulation_state_by_score(states, 200)["name"] == "Last"
