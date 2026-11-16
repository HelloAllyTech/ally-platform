"""The Writer is told when a session is part of a course: course roleplays first."""

from app.core.debrief.steps import _practice_instruction


def test_a_course_session_is_told_to_stay_in_the_course():
    lines = _practice_instruction(
        [
            {
                "id": 3,
                "title": "This one",
                "skills": [],
                "course": "Basics",
                "this_roleplay": True,
            },
        ]
    )
    assert any("part of a course" in line for line in lines)


def test_a_library_session_reads_as_before():
    lines = _practice_instruction([{"id": 9, "title": "x", "skills": []}])
    assert len(lines) == 1
    assert not any("course" in line for line in lines)


def test_no_options_sets_every_id_to_null():
    assert _practice_instruction([]) == [
        "PRACTICE OPTIONS: none. Set every scenario_id to null."
    ]


def test_a_course_session_may_go_outside_the_course_only_when_it_fits_better():
    lines = _practice_instruction(
        [
            {
                "id": 3,
                "title": "This one",
                "skills": [],
                "course": "Basics",
                "this_roleplay": True,
            },
            {
                "id": 99,
                "title": "Own",
                "skills": ["Empathy"],
                "course": "Basics",
                "outside_course": True,
            },
        ]
    )
    text = " ".join(lines)
    assert "outside_course" in text
    assert "Prefer a course roleplay" in text
    assert "never anything outside it" not in text
