"""The Evaluator's hard fails as the run counts them, and the line the console
shows for the step (a possible-only missed cue must not read as a hard fail)."""

from app.core.debrief.cue_strength import effective_hard_fails
from app.core.debrief_graph.narration import evaluator_summary

DIMS = [
    {"dimension": d, "score": 9}
    for d in (
        "evidence_specificity",
        "accuracy",
        "actionability",
        "prioritisation",
        "personalisation_progress",
        "practice_alignment",
        "tone",
        "clarity",
    )
]
HARD = [{"code": "missed_risk_cue", "evidence": "turn 1"}]


def _cue(turn, clear, addressed=False, quote="Today was a bit heavy."):
    return {
        "turn_index": turn,
        "quote": quote,
        "clear": clear,
        "addressed_by_debrief": addressed,
    }


def test_a_possible_only_missed_cue_is_not_a_hard_fail():
    fails, clear, possible = effective_hard_fails(
        HARD,
        [_cue(1, False), _cue(4, False)],
        [{"turn_index": 1, "strength": "possible"}],
    )
    assert fails == []
    assert clear == []
    assert [c["turn_index"] for c in possible] == [1, 4]


def test_a_clear_missed_cue_keeps_the_hard_fail():
    fails, clear, _ = effective_hard_fails(
        HARD, [_cue(10, True, quote="what's the point")], []
    )
    assert [h["code"] for h in fails] == ["missed_risk_cue"]
    assert [c["turn_index"] for c in clear] == [10]


def test_an_addressed_cue_leaves_other_hard_fails_alone():
    other = [{"code": "diagnoses_trainee", "evidence": "x"}]
    fails, _, possible = effective_hard_fails(other + HARD, [_cue(1, False)], [])
    assert [h["code"] for h in fails] == ["diagnoses_trainee"]
    assert len(possible) == 1


def test_the_step_line_shows_the_counted_hard_fails():
    res = {"evaluation": {"dimensions": DIMS, "hard_fails": HARD, "fixes": []}}
    raw = evaluator_summary(res)
    counted = evaluator_summary(res, [])
    assert "hard fails: missed_risk_cue" in raw
    assert counted.startswith("9.0 overall; no hard fail")
