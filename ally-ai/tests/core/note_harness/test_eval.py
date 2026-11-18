"""Scoring for the Scribe v2 quality gate."""

import pytest

from app.core.note_harness.eval import (
    EvalCase,
    FactMatch,
    kendall_tau,
    parse_judge,
    score_facts,
    score_fields,
    score_note,
    summarise,
)


def test_kendall_tau():
    assert kendall_tau([0, 1, 2, 3]) == 1.0
    assert kendall_tau([3, 2, 1, 0]) == -1.0
    assert kendall_tau([0, 2, 1, 3]) == pytest.approx(4 / 6)
    assert kendall_tau([5]) is None
    # Two facts stated in one point: a tie, not a mistake.
    assert kendall_tau([1, 1]) == 0.0


def test_score_facts_orders_by_reference():
    # Facts 0..3 in session order; the note states fact 2 before fact 1 and
    # never states fact 3.
    matches = [
        FactMatch(fact_index=0, point_index=0),
        FactMatch(fact_index=1, point_index=4),
        FactMatch(fact_index=2, point_index=2),
        FactMatch(fact_index=3, point_index=None),
    ]
    s = score_facts(matches, 4)
    assert s["fact_recall"] == 0.75
    assert s["order_tau"] == pytest.approx(1 / 3)
    assert s["matched"] == 3


def test_score_fields():
    reference = {
        "f-ref": "o-poster",
        "f-topics": ["t-sleep", "t-family"],
        "f-age": None,  # never said: must stay empty
        "f-follow": True,
        "f-num": 3,
    }
    predicted = {
        "f-ref": "o-poster",
        "f-topics": ["t-family", "t-sleep"],
        "f-age": 17,
        "f-num": 3.0,
    }
    s = score_fields(predicted, reference)
    assert s == {
        "field_accuracy": 0.75,
        "fields_scored": 4,
        "invented_fields": 1,
        "missed_fields": 1,
    }


def test_parse_judge_drops_bad_rows():
    answer = {
        "matches": [
            {"fact_index": 0, "point_index": 1},
            {"fact_index": 0, "point_index": 2},  # duplicate fact
            {"fact_index": 1, "point_index": 9},  # point out of range
            {"fact_index": 7, "point_index": 0},  # fact out of range
            "junk",
        ]
    }
    assert parse_judge(answer, fact_count=2, point_count=3) == [
        FactMatch(fact_index=0, point_index=1),
        FactMatch(fact_index=1, point_index=None),
    ]


@pytest.mark.asyncio
async def test_score_note_and_summary():
    case = EvalCase(
        id="c1",
        segments_text="0.00-1.00: hi",
        facts=[{"text": "A"}, {"text": "B"}],
        fields={"f": "x"},
    )

    async def judge(facts, points):
        return [
            FactMatch(fact_index=0, point_index=0),
            FactMatch(fact_index=1, point_index=1),
        ]

    s = await score_note(case, ["one two", "three"], {"f": "X "}, judge, budget_words=6)
    assert s.fact_recall == 1.0 and s.order_tau == 1.0
    assert s.field_accuracy == 1.0
    assert s.length_ratio == 0.5

    empty = await score_note(case, [], {}, judge)
    assert empty.fact_recall == 0.0 and empty.missed_fields == 1

    assert summarise([s, empty]) == {
        "cases": 2,
        "fact_recall": 0.5,
        "order_tau": 1.0,
        "field_accuracy": 0.5,
        "invented_fields": 0,
        "length_ratio": 0.5,
    }
