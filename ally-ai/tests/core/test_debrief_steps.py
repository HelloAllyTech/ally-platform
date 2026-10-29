"""The debrief agent's steps after the Safety reader, and the Improver's
analysis: each runs on the model the recipe names with no silent substitute,
keeps only evidence anchored to the right speaker, and never coerces a missing
answer into an empty one."""

import pytest
from fastapi.testclient import TestClient

from app.core.debrief.improver import ImproverAnalysis, ImproverIdea
from app.core.debrief.safety_reader import TranscriptTurn
from app.core.debrief.schemas import (
    BehaviourEvidence,
    DebriefCards,
    EvaluationOutput,
    EvidenceMap,
    PivotalMoment,
    ProgressItem,
    ProgressReading,
)
from app.core.debrief_quality.schemas import DimensionScore, RiskCue

TRANSCRIPT = [
    TranscriptTurn(turn_index=1, role="counselor", text="What brings you in?"),
    TranscriptTurn(turn_index=2, role="client", text="I don't want to be here."),
    TranscriptTurn(turn_index=3, role="counselor", text="Shall we talk about exams?"),
]
DIMS = [
    "evidence_specificity",
    "accuracy",
    "actionability",
    "prioritisation",
    "personalisation_progress",
    "practice_alignment",
    "tone",
    "clarity",
]


@pytest.fixture
def dispatch_returns(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    def _set(output, model="gemini-2.5-pro"):
        async def _fake(**kwargs):
            calls.update(kwargs)
            return output, {
                "provider": "gemini",
                "model": model,
                "fell_back_from": None,
            }

        monkeypatch.setattr(dispatch, "generate_structured", _fake)
        return calls

    return _set


@pytest.mark.asyncio
async def test_analyst_drops_anchors_on_client_turns(dispatch_returns):
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(
        EvidenceMap(
            behaviours=[
                BehaviourEvidence(
                    skill="open question",
                    opportunity=True,
                    observation="observed",
                    confidence="high",
                    importance=2,
                    turn_index=1,
                    quote="What brings you in?",
                    note="ok",
                ),
                BehaviourEvidence(
                    skill="exploring risk",
                    opportunity=True,
                    observation="missed",
                    confidence="high",
                    importance=3,
                    turn_index=2,
                    quote="I don't want to be here.",
                    note="cue passed by",
                ),
            ],
            pivotal_moments=[
                PivotalMoment(turn_index=2, summary="s", why_it_matters="w"),
                PivotalMoment(turn_index=99, summary="s", why_it_matters="w"),
            ],
        )
    )
    out, model = await analyse(TRANSCRIPT, "en", "gemini-2.5-pro")
    assert model == "gemini-2.5-pro"
    assert calls["never_fallback"] is True and calls["model"] == "gemini-2.5-pro"
    assert calls["task"] == "debrief_analyst"
    assert out.behaviours[0].turn_index == 1
    # A client turn is not evidence of the counsellor's behaviour.
    assert out.behaviours[1].turn_index is None and out.behaviours[1].quote is None
    assert [m.turn_index for m in out.pivotal_moments] == [2]


@pytest.mark.asyncio
async def test_progress_reader_keeps_three_items(dispatch_returns):
    from app.core.debrief.steps import read_progress

    dispatch_returns(
        ProgressReading(
            items=[
                ProgressItem(skill=f"s{i}", trend="too_early", evidence="")
                for i in range(5)
            ]
        )
    )
    out, _ = await read_progress({"behaviours": []}, [], "gemini-2.5-flash")
    assert len(out.items) == 3


@pytest.mark.asyncio
async def test_writer_never_sees_the_rubric_and_notes_distress(dispatch_returns):
    from app.core.debrief.steps import write

    calls = dispatch_returns(DebriefCards(opening="Hi"), model="gemini-3-flash-preview")
    out, model = await write(
        {"behaviours": []},
        {"risk_cues": [], "learner_distress": [{"turn_index": 3}]},
        "hi",
        "gemini-3-flash-preview",
        TRANSCRIPT,
        short=True,
    )
    assert out.opening == "Hi" and model == "gemini-3-flash-preview"
    prompt = calls["prompt"]
    assert "LEARNER DISTRESS" in prompt and "SHORT SESSION" in prompt
    assert "SESSION LANGUAGE: hi" in prompt
    assert "HARD FAILS" not in prompt  # the rubric is the Evaluator's, not the Writer's


@pytest.mark.asyncio
async def test_evaluator_raises_missed_risk_cue_from_its_cue_list(dispatch_returns):
    from app.core.debrief.steps import evaluate

    calls = dispatch_returns(
        EvaluationOutput(
            risk_cues=[
                RiskCue(
                    turn_index=2,
                    quote="I don't want to be here.",
                    addressed_by_debrief=False,
                )
            ],
            dimensions=[
                DimensionScore(dimension=d, score=8, reasoning="r") for d in DIMS
            ],
        ),
        model="gemini-2.5-flash",
    )
    out, _ = await evaluate(TRANSCRIPT, "A debrief.", "en", "gemini-2.5-flash")
    assert [h.code for h in out.hard_fails] == ["missed_risk_cue"]
    assert "FIX NOTES" in calls["prompt"]
    assert calls["task"] == "debrief_evaluator"


@pytest.mark.asyncio
async def test_evaluator_with_partial_scores_is_no_answer(dispatch_returns):
    from app.core.debrief.steps import evaluate

    dispatch_returns(
        EvaluationOutput(
            dimensions=[DimensionScore(dimension="tone", score=9, reasoning="r")]
        )
    )
    out, _ = await evaluate(TRANSCRIPT, "A debrief.", "en", "gemini-2.5-flash")
    assert out is None


@pytest.mark.asyncio
async def test_improver_turns_an_unappliable_edit_into_a_question(dispatch_returns):
    from app.core.debrief.improver import analyse_signals

    def idea(**kw):
        base = dict(
            kind="prompt_edit",
            title="t",
            hypothesis="h",
            evidence="e",
            expected_effect="x",
            prompt_code="debrief_writer_system",
        )
        base.update(kw)
        return ImproverIdea(**base)

    dispatch_returns(
        ImproverAnalysis(
            report="r",
            ideas=[
                idea(find="Warm, direct", replace="Warm and direct"),
                idea(find="not in the prompt", replace="x"),
                idea(prompt_code="debrief_quality_rubric", find="a", replace="b"),
            ],
        )
    )
    out, _ = await analyse_signals(
        {"runs": 10},
        {"debrief_writer_system": "Warm, direct and specific."},
        {},
        [],
        "gemini-2.5-pro",
    )
    assert [i.kind for i in out.ideas] == [
        "prompt_edit",
        "needs_person",
        "needs_person",
    ]


def test_endpoints_return_502_when_the_model_gives_nothing(monkeypatch):
    from app.core.config import settings
    from app.core.debrief import steps
    from app.main import app

    async def _none(*args, **kwargs):
        return None, "gemini-2.5-pro"

    monkeypatch.setattr(steps, "analyse", _none)
    monkeypatch.setattr(steps, "write", _none)
    client = TestClient(app)
    headers = {"x-api-key": settings.API.X_API_KEY}
    for path, body in [
        ("/api/v1/debrief/analyst", {"transcript": []}),
        ("/api/v1/debrief/writer", {"evidence": {}}),
    ]:
        res = client.post(path, json=body, headers=headers)
        assert res.status_code == 502, res.text
        assert "no usable answer" in res.json()["detail"]


def test_judge_and_evaluator_see_the_history_the_writer_saw():
    from app.core.debrief_quality.prompt import build_judge_prompt

    p = build_judge_prompt(
        [{"role": "counselor", "text": "hi", "turn_index": 1}],
        "You are still interrupting, as last time.",
        "en",
        history="2026-10-20 pacing: Let the client finish.",
    )
    assert "<trainee_history>" in p and "Let the client finish." in p
    assert "<trainee_history>" not in build_judge_prompt([], "d", "en")


@pytest.mark.asyncio
async def test_writer_is_told_every_risk_cue_turn_to_cover(dispatch_returns):
    from app.core.debrief.steps import write

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write(
        {},
        {
            "risk_cues": [{"turn_index": 9}, {"turn_index": 2}, {"turn_index": 9}],
            "learner_distress": [],
        },
        "en",
        "gemini-3-flash-preview",
        TRANSCRIPT,
    )
    assert "RISK CUES TO COVER: turns 2, 9." in calls["prompt"]
