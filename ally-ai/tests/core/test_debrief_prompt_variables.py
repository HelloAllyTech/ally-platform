"""Step 5 (2026-11-16): the Debrief prompts carry `{{name}}` placeholders, the
code fills them, and a live text missing a required one fails the step loudly.
No fallback appends the data (the owner decided no backward compatibility)."""

import pytest

from app.core.debrief.render import PromptVariableMissing, placeholders, render
from app.core.debrief.safety_reader import TranscriptTurn

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="I want to end it all."),
]
SAFETY = {
    "risk_cues": [
        {"turn_index": 2, "strength": "clear", "learner_response": "missed"},
        {"turn_index": 4, "strength": "possible", "learner_response": "missed"},
    ],
    "learner_distress": [],
}


@pytest.fixture
def prompts(monkeypatch):
    from app.core.llm import dispatch

    sent = []

    async def _fake(**kwargs):
        sent.append(kwargs["prompt"])
        return None, {"provider": "gemini", "model": "m"}

    monkeypatch.setattr(dispatch, "generate_structured", _fake)
    return sent


def test_render_fills_once_and_never_rescans_values():
    out = render("c", "A {{x}} B {{ y }} {z} {{unknown}}", {"x": "{{y}}", "y": "2"})
    assert out == "A {{y}} B 2 {z} "


def test_a_missing_required_variable_names_the_prompt_and_the_variable():
    with pytest.raises(PromptVariableMissing) as e:
        render(
            "debrief_writer_system", "No placeholders.", {}, required=("transcript",)
        )
    assert "debrief_writer_system" in str(e.value) and "{{transcript}}" in str(e.value)


@pytest.mark.asyncio
async def test_every_main_step_fails_loudly_on_old_text(prompts):
    from app.core.debrief import steps
    from app.core.debrief.safety_reader import read_safety

    old = "An old live text with no placeholders."
    calls = [
        steps.write({}, SAFETY, "en", "m", TRANSCRIPT, system=old),
        steps.revise({}, [], {}, TRANSCRIPT, "en", "m", system=old),
        steps.analyse(TRANSCRIPT, "en", "m", system=old),
        steps.read_progress({}, [], "m", system=old),
        steps.evaluate(TRANSCRIPT, "d", "en", "m", rubric=old),
        steps.evaluate(TRANSCRIPT, "d", "en", "m", fix_system=old),
        steps.plan_agents({}, [], "m", max_agents=2, system=old),
        read_safety(TRANSCRIPT, "en", system=old, model="m"),
    ]
    for c in calls:
        with pytest.raises(PromptVariableMissing):
            await c
    assert prompts == []


@pytest.mark.asyncio
async def test_the_rendered_defaults_hold_every_datum_once_and_no_placeholder(prompts):
    from app.core.debrief import steps
    from app.core.debrief.safety_reader import read_safety

    await read_safety(TRANSCRIPT, "hi", model="m")
    await steps.write(
        {"behaviours": [{"skill": "Reflections"}]},
        SAFETY,
        "hi",
        "m",
        TRANSCRIPT,
        passages=[{"title": "G1", "text": "Ask directly."}],
        progress={"items": ["P1"]},
        learner_level="LAY",
        tone="Warm",
    )
    await steps.revise(
        {"opening": "DRAFT"}, [{"note": "C1"}], {}, TRANSCRIPT, "hi", "m", safety=SAFETY
    )
    await steps.evaluate(
        TRANSCRIPT, "THE DEBRIEF", "hi", "m", guidance="G2", history="H1", pass_score=8
    )
    await steps.plan_agents({"p": 1}, [{"id": "a"}], "m", max_agents=3)
    safety_p, writer_p, reviser_p, eval_p, plan_p = prompts
    for p in prompts:
        assert "{{" not in p
    for p in (safety_p, writer_p, reviser_p, eval_p):
        assert p.count("RISK CUE DEFINITION:") == 1
    assert safety_p.count("[turn 2] CLIENT: I want to end it all.") == 1
    for datum in [
        "[turn 2] CLIENT: I want to end it all.",
        "<evidence_map>",
        "<safety_reading>",
        "RISK CUES TO COVER: turns 2.",
        "POSSIBLE RISK CUES: turns 4.",
        "MISSED FEELINGS: turns 4.",
        "TRAINEE LEVEL: LAY",
        "ORGANISATION TONE: Warm",
        "Ask directly.",
        "P1",
        "Devanagari",
        "SKILL LABELS:",
        "Never mention turn numbers",
    ]:
        assert writer_p.count(datum) == 1, datum
    # The Reviser now also gets the clear cues it must keep covered.
    for datum in ["RISK CUES TO COVER: turns 2.", "DRAFT", '"C1"', "<draft>"]:
        assert reviser_p.count(datum) == 1, datum
    for datum in ["THE DEBRIEF", "G2", "H1", "PASS BAR: 8", "FIX SECTIONS: opening"]:
        assert eval_p.count(datum) == 1, datum
    assert eval_p.index("<debrief>") < eval_p.index("List the risk cues first")
    for datum in ["Choose at most 3 agents.", "TOP-UP: none", "<available_agents>"]:
        assert plan_p.count(datum) == 1, datum


def test_the_defaults_put_the_data_last():
    """The fixed wording first, the placeholders at the end (a cacheable prefix)."""
    from app.core.debrief import steps
    from app.core.debrief.safety_reader import DEFAULT_SAFETY_READER_SYSTEM
    from app.core.debrief_quality.prompt import DEFAULT_JUDGE_RUBRIC

    for text in [
        steps.DEFAULT_WRITER_SYSTEM,
        steps.DEFAULT_REVISER_SYSTEM,
        steps.DEFAULT_ANALYST_SYSTEM,
        steps.DEFAULT_PROGRESS_SYSTEM,
        steps.DEFAULT_PLANNER_SYSTEM,
        DEFAULT_SAFETY_READER_SYSTEM,
        DEFAULT_JUDGE_RUBRIC,
    ]:
        assert placeholders(text)
        head, _, _ = text.partition("THE SESSION.")
        assert "{{" not in head
