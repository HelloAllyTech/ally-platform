"""The debrief agent's steps after the Safety reader: each runs on the model the
recipe names with no silent substitute, keeps only evidence anchored to the right
speaker, and never coerces a missing answer into an empty one."""

import pytest

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
async def test_a_step_with_no_usable_answer_is_a_502_failure(monkeypatch):
    """The graph treats it like any failed attempt: retry on the backup model."""
    from app.core.debrief import steps
    from app.core.debrief_graph.step_functions import InProcessSteps, StepError

    async def _none(*args, **kwargs):
        return None, "gemini-2.5-pro"

    monkeypatch.setattr(steps, "analyse", _none)
    monkeypatch.setattr(steps, "write", _none)
    for path, body in [("analyst", {"transcript": []}), ("writer", {"evidence": {}})]:
        with pytest.raises(StepError) as err:
            await InProcessSteps().run(path, body, None, None)
        assert err.value.status == 502
        assert "no usable answer" in str(err.value)


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
    assert "POSSIBLE RISK CUES" not in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_must_cover_a_clear_cue_and_decides_a_possible_one(
    dispatch_returns,
):
    """A low-mood cue the reader filed under hopelessness is the Writer's call
    (2026-11-12 gold sessions); a clear one is still required."""
    from app.core.debrief.steps import write

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write(
        {},
        {
            "risk_cues": [
                {"turn_index": 2, "strength": "clear"},
                {"turn_index": 5, "strength": "possible"},
                {"turn_index": 7, "strength": "possible"},
            ],
            "learner_distress": [],
        },
        "en",
        "gemini-3-flash-preview",
        TRANSCRIPT,
    )
    assert "RISK CUES TO COVER: turns 2." in calls["prompt"]
    assert "POSSIBLE RISK CUES: turns 5, 7." in calls["prompt"]
    assert "or you are unsure, treat it as a risk cue" in calls["prompt"]

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write(
        {},
        {"risk_cues": [{"turn_index": 5, "strength": "possible"}]},
        "en",
        "gemini-3-flash-preview",
        TRANSCRIPT,
    )
    assert "RISK CUES TO COVER" not in calls["prompt"]
    assert "POSSIBLE RISK CUES: turns 5." in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_may_point_only_to_the_learners_own_roleplays(dispatch_returns):
    from app.core.debrief.steps import write

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    options = [{"id": 41, "title": "Exam stress", "skills": ["Open questions"]}]
    await write(
        {}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT, practice_options=options
    )
    assert "PRACTICE OPTIONS: practice_options lists roleplays" in calls["prompt"]
    assert '"Exam stress"' in calls["prompt"]

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "PRACTICE OPTIONS: none. Set every scenario_id to null." in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_respects_case_memory_and_never_regrades(dispatch_returns):
    from app.core.debrief.steps import write

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write(
        {},
        {},
        "en",
        "gemini-3-flash-preview",
        TRANSCRIPT,
        case_memory="Meena told you about her exams last time.",
        assessment=True,
    )
    assert "CASE MEMORY:\nMeena told you about her exams last time." in calls["prompt"]
    assert "Never contradict it" in calls["prompt"]
    assert "Never mention, imply or argue with a grade" in calls["prompt"]

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "CASE MEMORY" not in calls["prompt"]
    assert "ASSESSMENT" not in calls["prompt"]


@pytest.mark.asyncio
async def test_each_step_runs_on_the_provider_its_model_names(monkeypatch):
    import app.core.llm.dispatch as dispatch
    from app.core.debrief.steps import write

    seen = []

    async def fake(**kwargs):
        seen.append(kwargs["provider"])
        return DebriefCards(opening="Hi"), {"model": kwargs["model"]}

    monkeypatch.setattr(dispatch, "generate_structured", fake)
    for model in ("claude-sonnet-5-5", "gpt-5-mini", "gemini-2.5-flash"):
        await write({}, {}, "en", model, TRANSCRIPT)
    assert seen == ["anthropic", "openai", "gemini"]


# --- Reasoning out loud, live detections, cohort (v9 FR-7, FR-17, FR-38) -------


@pytest.mark.asyncio
async def test_steps_ask_for_a_rationale_last_in_their_schema(dispatch_returns):
    from app.core.debrief.schemas import DebriefCardsReasoned, EvidenceMapReasoned
    from app.core.debrief.steps import analyse, write

    calls = dispatch_returns(EvidenceMapReasoned(reasoning="Turn 3 changed topic."))
    await analyse(TRANSCRIPT, "en", "gemini-2.5-pro")
    assert calls["schema"] is EvidenceMapReasoned
    assert list(EvidenceMapReasoned.model_fields)[-1] == "reasoning"

    calls = dispatch_returns(DebriefCardsReasoned(opening="Hi", reasoning="x"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert calls["schema"] is DebriefCardsReasoned
    assert list(DebriefCardsReasoned.model_fields)[-1] == "reasoning"


@pytest.mark.asyncio
async def test_the_rationale_never_reaches_the_cards_or_the_evidence(monkeypatch):
    """The step functions serialise the parent types, so the rationale travels
    only in `reasoning`: nothing a learner reads can carry it."""
    from app.core.debrief import steps
    from app.core.debrief.schemas import DebriefCardsReasoned, EvidenceMapReasoned
    from app.core.debrief_graph.step_functions import InProcessSteps

    async def _analyse(*args, **kwargs):
        return EvidenceMapReasoned(reasoning="Why I read it so."), "gemini-2.5-pro"

    async def _write(*args, **kwargs):
        return (
            DebriefCardsReasoned(opening="Hi", reasoning="Why I wrote it so."),
            "gemini-3-flash-preview",
        )

    monkeypatch.setattr(steps, "analyse", _analyse)
    monkeypatch.setattr(steps, "write", _write)

    body = await InProcessSteps().run("analyst", {"transcript": []}, None, None)
    assert body["reasoning"] == "Why I read it so."
    assert "reasoning" not in body["evidence"]

    body = await InProcessSteps().run("writer", {"evidence": {}}, None, None)
    assert body["reasoning"] == "Why I wrote it so."
    assert "reasoning" not in body["cards"]


@pytest.mark.asyncio
async def test_analyst_reads_the_live_detector_as_a_second_opinion(dispatch_returns):
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(EvidenceMap())
    await analyse(
        TRANSCRIPT,
        "en",
        "gemini-2.5-pro",
        live_detections=[{"behaviour": "Explores risk", "detected": False, "times": 0}],
    )
    prompt = calls["prompt"]
    assert "LIVE DETECTIONS" in prompt and "It can be wrong" in prompt
    assert '"behaviour": "Explores risk"' in prompt

    calls = dispatch_returns(EvidenceMap())
    await analyse(TRANSCRIPT, "en", "gemini-2.5-pro")
    assert "LIVE DETECTIONS" not in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_may_use_the_cohort_only_to_normalise(dispatch_returns):
    from app.core.debrief.steps import write

    cohort = {
        "trainees": "five or more",
        "skills": [{"skill": "Explores risk", "how_often": "few trainees show this"}],
    }
    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT, cohort=cohort)
    prompt = calls["prompt"]
    assert "COHORT:" in prompt and "Never compare this trainee" in prompt
    assert "few trainees show this" in prompt

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "COHORT" not in calls["prompt"]


@pytest.mark.asyncio
async def test_writer_never_states_mixed_evidence_as_fact(dispatch_returns):
    from app.core.debrief.steps import write

    evidence = {
        "behaviours": [{"skill": "Reflections", "detector_agreement": "disagrees"}]
    }
    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write(evidence, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "MIXED EVIDENCE" in calls["prompt"]


@pytest.mark.asyncio
async def test_analyst_tags_behaviours_for_skill_coverage(dispatch_returns):
    """v9 FR-42: ally-be computes skill coverage from these tags."""
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(EvidenceMap())
    await analyse(TRANSCRIPT, "en", "gemini-2.5-pro")
    assert "SKILL COVERAGE" in calls["prompt"]
    b = BehaviourEvidence(
        skill="reflections",
        opportunity=True,
        observation="observed",
        confidence="high",
        importance=2,
        note="ok",
        coverage_category="Emotional Attunement",
    )
    assert b.coverage_category == "Emotional Attunement"


@pytest.mark.asyncio
async def test_analyst_rates_client_turns_and_updates_case_memory(dispatch_returns):
    """v9 FR-4: emotional movement and a case's memory now come from here."""
    from app.core.debrief.schemas import EmotionLevel
    from app.core.debrief.steps import analyse

    calls = dispatch_returns(
        EvidenceMap(
            emotional_movement=[
                EmotionLevel(turn_index=2, level=-3),
                # A counsellor turn: dropped.
                EmotionLevel(turn_index=1, level=2),
            ],
            case_memory_update="She is still anxious about exams.",
        )
    )
    out, _ = await analyse(
        TRANSCRIPT, "en", "gemini-2.5-pro", case_memory="Exams worry her."
    )
    assert [(e.turn_index, e.level) for e in out.emotional_movement] == [(2, -3)]
    assert out.case_memory_update == "She is still anxious about exams."
    prompt = calls["prompt"]
    assert "EMOTIONAL MOVEMENT" in prompt and "CASE MEMORY:" in prompt

    calls = dispatch_returns(EvidenceMap(case_memory_update="invented"))
    out, _ = await analyse(TRANSCRIPT, "en", "gemini-2.5-pro")
    assert out.case_memory_update is None
    assert "CASE MEMORY" not in calls["prompt"]


@pytest.mark.asyncio
async def test_a_hindi_debrief_is_written_in_devanagari_even_from_romanised_turns(
    dispatch_returns,
):
    """GOLD-MIX-MEANS (2026-11-12): an all-Latin Hinglish transcript got a
    romanised Hindi debrief, and ally-be's language check held it."""
    from app.core.debrief.steps import revise, write

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "hi-IN", "gemini-3-flash-preview", TRANSCRIPT)
    assert "SCRIPT: write everything in Devanagari script" in calls["prompt"]
    assert "quotes from the transcript keep the script" in calls["prompt"]

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await revise({}, [], {}, TRANSCRIPT, "hi", "gemini-3-flash-preview")
    assert "SCRIPT: write everything in Devanagari script" in calls["prompt"]

    calls = dispatch_returns(DebriefCards(opening="Hi"))
    await write({}, {}, "en", "gemini-3-flash-preview", TRANSCRIPT)
    assert "SCRIPT:" not in calls["prompt"]
