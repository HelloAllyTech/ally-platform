"""Inside a course the Writer offers only this same roleplay: "Practise this
again", with up to 3 things to try (clinical review 2026-11-16)."""

from app.core.debrief.schemas import DebriefCards, PractiseNext
from app.core.debrief.steps import _capped_try_next, _practice_instruction

COURSE_OPTION = {
    "id": 3,
    "title": "This one",
    "skills": [],
    "course": "Basics",
    "this_roleplay": True,
    "trackItemId": "i3",
}


def test_a_course_session_practises_this_roleplay_again_with_try_next():
    text = " ".join(_practice_instruction([COURSE_OPTION]))
    assert "part of a course" in text
    assert "never suggest another one" in text
    assert "practise_next.scenario_id to 3" in text
    assert "try_next" in text
    assert "missed or partial" in text
    assert "no quotes and no ids" in text
    assert "outside_course" not in text


def test_a_library_session_reads_as_before_with_no_try_next():
    lines = _practice_instruction([{"id": 9, "title": "x", "skills": []}])
    assert len(lines) == 1
    assert "course" not in lines[0]
    assert "try_next to null" in lines[0]


def test_no_options_sets_every_id_to_null():
    assert _practice_instruction([]) == [
        "PRACTICE OPTIONS: none. Set every scenario_id to null. Set "
        "practise_next.try_next to null."
    ]


def test_try_next_is_capped_at_three_non_empty_items():
    cards = DebriefCards(
        opening="x",
        practise_next=PractiseNext(
            skill="Empathy",
            reason="Again.",
            scenario_id=3,
            try_next=["a", " ", "b", "c", "d"],
        ),
    )
    assert _capped_try_next(cards).practise_next.try_next == ["a", "b", "c"]
    assert _capped_try_next(None) is None
