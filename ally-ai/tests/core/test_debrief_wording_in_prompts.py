"""Wording lives in the prompts; code adds data, format and checked safety lines
(2026-11-16). These pin the move: the default prompt plus the code's lines
carry each key instruction exactly once on the main paths, and ally-ai's
fallback defaults match ally-be's seed text word for word."""

from pathlib import Path

import pytest

from app.core.debrief.safety_reader import TranscriptTurn

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="I don't want to be here."),
    TranscriptTurn(turn_index=3, role="counselor", text="Shall we talk about exams?"),
]

SEED = Path(__file__).resolve().parents[3] / "ally-be/src/prompts/debrief"


@pytest.fixture
def prompts(monkeypatch):
    """Every prompt the steps send, in order."""
    from app.core.llm import dispatch

    sent = []

    async def _fake(**kwargs):
        sent.append(kwargs["prompt"])
        return None, {"provider": "gemini", "model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    return sent


def _once(prompt: str, phrases):
    low = prompt.lower()
    counts = {p: low.count(p.lower()) for p in phrases}
    assert counts == {p: 1 for p in phrases}, counts


@pytest.mark.parametrize(
    "name,seed",
    [
        ("DEFAULT_ANALYST_SYSTEM", "analyst_system.txt"),
        ("DEFAULT_PROGRESS_READER_SYSTEM", "progress_reader_system.txt"),
        ("DEFAULT_PROGRESS_SYSTEM", "progress_system.txt"),
        ("DEFAULT_WRITER_SYSTEM", "writer_system.txt"),
        ("DEFAULT_REVISER_SYSTEM", "reviser_system.txt"),
        ("DEFAULT_PLANNER_SYSTEM", "planner_system.txt"),
        ("DEFAULT_PROTOCOL_CHECK_SYSTEM", "protocol_check_system.txt"),
        ("DEFAULT_HISTORY_DEEP_SYSTEM", "history_deep_system.txt"),
        ("DEFAULT_LANGUAGE_SPECIALIST_SYSTEM", "language_specialist_system.txt"),
    ],
)
def test_the_fallback_matches_the_seed(name, seed):
    from app.core.debrief import steps

    path = SEED / seed
    if not path.exists():
        pytest.skip("ally-be is not checked out beside ally-ai")
    assert getattr(steps, name).strip() == path.read_text().strip()


@pytest.mark.asyncio
async def test_writer_every_instruction_once(prompts):
    from app.core.debrief.steps import write

    await write(
        {"behaviours": [{"skill": "Reflections", "detector_agreement": "disagrees"}]},
        {
            "risk_cues": [
                {"turn_index": 2, "strength": "clear", "learner_response": "missed"},
                {"turn_index": 5, "strength": "possible", "learner_response": "missed"},
            ],
            "learner_distress": [{"turn_index": 3, "quote": "x"}],
        },
        "en",
        "m",
        TRANSCRIPT,
        practice_options=[
            {"id": 3, "title": "t", "skills": [], "course": "c", "this_roleplay": True}
        ],
        case_memory="Meena worries about exams.",
        cohort={"trainees": "five or more", "skills": []},
        findings={"missed": [{"point": "x"}]},
    )
    _once(
        prompts[-1],
        [
            # Data and checked safety lines (code)
            "RISK CUES TO COVER: turns 2.",
            "POSSIBLE RISK CUES: turns 5.",
            "MISSED FEELINGS: turns 5.",
            "COURSE: this session is part of a course",
            "try_next applies, at most 3 items.",
            "Meena worries about exams.",
            "MIXED EVIDENCE: Reflections.",
            "<cohort>",
            "<findings>",
            "LEARNER DISTRESS: noted",
            "Never write a code such as 478_custom_27",
            # Wording (the prompt)
            "RISK CUE DEFINITION:",
            "you cannot tell, it is a clear risk cue",
            "no coaching about assessing risk",
            "Never a risk assessment.",
            "never suggest another one",
            "Outside a course, try_next is null.",
            "Never contradict it",
            "don't state them as certain",
            "Never compare this learner with others",
            "never compare or rank this learner",
            "a quote in a finding was checked against the transcript",
        ],
    )


@pytest.mark.asyncio
async def test_writer_outside_a_course_gets_no_course_line(prompts):
    from app.core.debrief.steps import write

    await write(
        {},
        {},
        "en",
        "m",
        TRANSCRIPT,
        practice_options=[{"id": 9, "title": "t", "skills": []}],
    )
    assert "COURSE: this session" not in prompts[-1]
    _once(prompts[-1], ["Set practise_next.try_next to null."])


@pytest.mark.asyncio
async def test_analyst_every_instruction_once(prompts):
    from app.core.debrief.steps import analyse

    await analyse(
        TRANSCRIPT,
        "en",
        "m",
        helpful_behaviours=["Asks open questions"],
        unhelpful_behaviours=["Lets the client finish"],
        competencies=[{"name": "QPR", "helpful": [], "unhelpful": []}],
        live_detections=[{"behaviour": "QPR", "detected": False}],
        case_memory="Meena worries about exams.",
    )
    _once(
        prompts[-1],
        [
            "<roleplay_expectations>",
            "Never write a code such as 478_custom_27",
            "Write case_memory_update",
            "<live_detections>",
            "set detector_agreement",
            "did the learner show the helpful ones",
            "never as if it had a definition",
            "say so in the note and lower your confidence",
            "about the character and the case only, never the learner",
            "It can be wrong.",
            "lower your confidence and say in the note that the evidence is mixed",
        ],
    )


@pytest.mark.asyncio
async def test_reviser_every_instruction_once(prompts):
    from app.core.debrief.steps import revise

    await revise({}, [], {}, TRANSCRIPT, "en", "m", findings={"missed": []})
    _once(
        prompts[-1],
        [
            "<findings>",
            "never compare or rank this learner",
            "a quote in a finding was checked against the transcript",
            "Never write a code such as 478_custom_27",
        ],
    )


@pytest.mark.asyncio
async def test_progress_steps_every_instruction_once(prompts):
    from app.core.debrief.steps import read_progress, read_progress_report

    await read_progress(
        {"behaviours": []},
        [{"point": "x", "learner_note": "no", "ally_decision": "kept"}],
        "m",
    )
    _once(
        prompts[-1],
        [
            "HOW TO USE WHAT PEOPLE SAID ABOUT EARLIER DEBRIEFS",
            "never drop it because the learner pushed back",
            "never quote the expert",
        ],
    )
    await read_progress_report({}, {}, {}, "en", "m")
    _once(
        prompts[-1],
        [
            "WHAT PEOPLE SAID ABOUT PAST POINTS",
            "never drop it because the learner pushed back",
            "never quote the expert",
        ],
    )


@pytest.mark.asyncio
async def test_no_moved_wording_is_left_in_code(prompts):
    """With a live text that is only the placeholders, only data, format and
    checked safety lines remain: none of the moved wording."""
    from app.core.debrief import steps
    from app.core.debrief.render import placeholders

    def bare(default):
        return " ".join("{{" + n + "}}" for n in placeholders(default))

    await steps.write(
        {"behaviours": [{"skill": "R", "detector_agreement": "disagrees"}]},
        {"risk_cues": [{"turn_index": 5, "strength": "possible"}]},
        "en",
        "m",
        TRANSCRIPT,
        system=bare(steps.DEFAULT_WRITER_SYSTEM),
        practice_options=[
            {"id": 3, "title": "t", "skills": [], "course": "c", "this_roleplay": True}
        ],
        case_memory="m",
        cohort={"x": 1},
        findings={"missed": []},
        risk_cue_definition="DEF",
    )
    await steps.analyse(
        TRANSCRIPT,
        "en",
        "m",
        system=bare(steps.DEFAULT_ANALYST_SYSTEM),
        helpful_behaviours=["h"],
        live_detections=[{"behaviour": "h"}],
        case_memory="m",
    )
    await steps.revise(
        {},
        [],
        {},
        TRANSCRIPT,
        "en",
        "m",
        system=bare(steps.DEFAULT_REVISER_SYSTEM),
        findings={"a": []},
        risk_cue_definition="DEF",
    )
    await steps.read_progress(
        {},
        [{"point": "x", "learner_note": "n"}],
        "m",
        system=bare(steps.DEFAULT_PROGRESS_READER_SYSTEM),
    )
    code_only = "\n".join(prompts).lower()
    for moved in [
        "or might and you cannot tell",
        "never suggest another one",
        "never contradict it",
        "don't state",
        "never compare this trainee",
        "checked against the transcript",
        "never as if it had a definition",
        "never the trainee",
        "it can be wrong",
        "how to use what people said",
    ]:
        assert moved not in code_only, moved


@pytest.mark.asyncio
async def test_a_plain_writer_call_has_none_of_the_conditional_data_lines(prompts):
    from app.core.debrief.steps import write

    await write({}, {}, "en", "m", TRANSCRIPT)
    for line in [
        "POSSIBLE RISK CUES: turns",
        "COURSE: this session",
        "<cohort>",
        "<findings>",
    ]:
        assert line not in prompts[-1]
    for line in [
        "POSSIBLE RISK CUES: none",
        "MISSED FEELINGS: none",
        "COURSE: none",
        "MIXED EVIDENCE: none",
    ]:
        assert prompts[-1].count(line) == 1
