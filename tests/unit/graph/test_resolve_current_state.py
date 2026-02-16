from app.core.graph.nodes import _resolve_current_state
from app.core.scenario.base import SimulationStateInstruction


def _make_state(
    state_id, instruction, score_lower=None, score_upper=None, dialogues=None
):
    return SimulationStateInstruction(
        stateId=state_id,
        instruction=instruction,
        scoreLower=score_lower,
        scoreUpper=score_upper,
        dialogues=dialogues,
    )


class TestResolveCurrentState:
    def test_returns_none_when_no_state_instructions(self):
        assert _resolve_current_state(None, 0) is None
        assert _resolve_current_state([], 0) is None

    def test_matches_state_with_both_bounds(self):
        states = [
            _make_state("1", "Be resistant", score_lower=-10, score_upper=0),
            _make_state("2", "Be neutral", score_lower=1, score_upper=5),
            _make_state("3", "Be open", score_lower=6, score_upper=10),
        ]
        result = _resolve_current_state(states, 3)
        assert result.state_id == "2"
        assert result.instruction == "Be neutral"

    def test_matches_state_at_lower_boundary(self):
        states = [
            _make_state("1", "Low", score_lower=0, score_upper=5),
            _make_state("2", "High", score_lower=6, score_upper=10),
        ]
        result = _resolve_current_state(states, 0)
        assert result.state_id == "1"

    def test_matches_state_at_upper_boundary(self):
        states = [
            _make_state("1", "Low", score_lower=0, score_upper=5),
            _make_state("2", "High", score_lower=6, score_upper=10),
        ]
        result = _resolve_current_state(states, 5)
        assert result.state_id == "1"

    def test_none_lower_bound_means_negative_infinity(self):
        states = [
            _make_state("1", "Negative", score_lower=None, score_upper=0),
            _make_state("2", "Positive", score_lower=1, score_upper=None),
        ]
        result = _resolve_current_state(states, -999)
        assert result.state_id == "1"

    def test_none_upper_bound_means_positive_infinity(self):
        states = [
            _make_state("1", "Negative", score_lower=None, score_upper=0),
            _make_state("2", "Positive", score_lower=1, score_upper=None),
        ]
        result = _resolve_current_state(states, 999)
        assert result.state_id == "2"

    def test_both_bounds_none_matches_any_score(self):
        states = [
            _make_state("1", "Catch-all", score_lower=None, score_upper=None),
        ]
        assert _resolve_current_state(states, -100).state_id == "1"
        assert _resolve_current_state(states, 0).state_id == "1"
        assert _resolve_current_state(states, 100).state_id == "1"

    def test_returns_none_when_score_outside_all_ranges(self):
        states = [
            _make_state("1", "Low", score_lower=0, score_upper=5),
            _make_state("2", "High", score_lower=10, score_upper=15),
        ]
        result = _resolve_current_state(states, 7)
        assert result is None

    def test_returns_first_matching_state_on_overlap(self):
        states = [
            _make_state("1", "First", score_lower=0, score_upper=10),
            _make_state("2", "Second", score_lower=5, score_upper=15),
        ]
        result = _resolve_current_state(states, 7)
        assert result.state_id == "1"

    def test_preserves_dialogues_on_resolved_state(self):
        states = [
            _make_state(
                "1",
                "Be open",
                score_lower=0,
                score_upper=10,
                dialogues=["I feel better now", "Things are improving"],
            ),
        ]
        result = _resolve_current_state(states, 5)
        assert result.dialogues == ["I feel better now", "Things are improving"]
