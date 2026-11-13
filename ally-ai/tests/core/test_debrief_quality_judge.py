"""The debrief-quality judge: what it sends, and what it refuses to return.

The judge's answer is stored as eight dimension scores, and ally-be computes a
weighted overall from them. A partial answer would read as a low overall, so
the judge must return all eight or nothing.
"""

import pytest
from fastapi.testclient import TestClient

from app.core.debrief_quality.prompt import build_judge_prompt
from app.core.debrief_quality.schemas import (
    DebriefQualityOutput,
    DimensionScore,
    HardFailFinding,
)

TRANSCRIPT = [
    {"role": "counselor", "turn_index": 1, "text": "What brings you in today?"},
    {"role": "client", "turn_index": 2, "text": "Sometimes there's no point."},
]
DIMENSIONS = [
    "evidence_specificity",
    "accuracy",
    "actionability",
    "prioritisation",
    "personalisation_progress",
    "practice_alignment",
    "tone",
    "clarity",
]


def _output(dimensions=DIMENSIONS, hard_fails=()):
    return DebriefQualityOutput(
        dimensions=[
            DimensionScore(dimension=d, score=7, reasoning="ok") for d in dimensions
        ],
        hard_fails=[HardFailFinding(code=c, evidence="turn 2") for c in hard_fails],
    )


@pytest.fixture
def dispatch_returns(monkeypatch):
    from app.core.llm import dispatch

    calls = {}

    def _set(output):
        async def _fake(**kwargs):
            calls.update(kwargs)
            return output, {
                "provider": "gemini",
                "model": "gemini-2.5-pro",
                "fell_back_from": None,
            }

        monkeypatch.setattr(dispatch, "generate_structured", _fake)
        return calls

    return _set


class TestPrompt:
    def test_numbers_every_turn_and_wraps_data(self):
        prompt = build_judge_prompt(TRANSCRIPT, "You listened.", "hi")
        assert "[turn 1] COUNSELLOR: What brings you in today?" in prompt
        assert "[turn 2] AI_CLIENT: Sometimes there's no point." in prompt
        assert "<debrief>\nYou listened.\n</debrief>" in prompt
        assert "SESSION LANGUAGE: hi" in prompt

    def test_optional_context_appears_only_when_given(self):
        bare = build_judge_prompt(TRANSCRIPT, "x", "en")
        assert "TRAINEE LEVEL" not in bare and "<guidance>" not in bare
        full = build_judge_prompt(
            TRANSCRIPT, "x", "en", learner_level="LAY", guidance="Ask directly."
        )
        assert "TRAINEE LEVEL: LAY" in full
        assert "<guidance>\nAsk directly.\n</guidance>" in full

    def test_a_supplied_rubric_replaces_the_default(self):
        prompt = build_judge_prompt(TRANSCRIPT, "x", "en", rubric="LIVE RUBRIC")
        assert prompt.startswith("LIVE RUBRIC")
        assert "WHO IS WHO" not in prompt


class TestInstructions:
    """The judge's instructions: the Skills Store's text, else the code's."""

    def test_without_the_store_the_prompt_ends_with_the_code_text(self):
        from app.core.debrief_quality.prompt import DEFAULT_JUDGE_INSTRUCTIONS

        prompt = build_judge_prompt(TRANSCRIPT, "x", "en")
        assert prompt.endswith(DEFAULT_JUDGE_INSTRUCTIONS)
        # A blank store text is no text: the fallback, not an empty ending.
        assert build_judge_prompt(TRANSCRIPT, "x", "en", instructions="  ") == prompt

    def test_the_store_text_replaces_the_code_text(self):
        from app.core.debrief_quality.prompt import DEFAULT_JUDGE_INSTRUCTIONS

        prompt = build_judge_prompt(
            TRANSCRIPT, "x", "en", instructions="LIVE INSTRUCTIONS"
        )
        assert prompt.endswith("LIVE INSTRUCTIONS")
        assert DEFAULT_JUDGE_INSTRUCTIONS not in prompt

    def test_the_store_text_identical_to_the_code_changes_nothing(self):
        from app.core.debrief_quality.prompt import DEFAULT_JUDGE_INSTRUCTIONS

        assert build_judge_prompt(
            TRANSCRIPT, "x", "en", instructions=DEFAULT_JUDGE_INSTRUCTIONS
        ) == build_judge_prompt(TRANSCRIPT, "x", "en")

    def test_the_default_matches_ally_be_seed_file(self):
        from pathlib import Path

        from app.core.debrief_quality.prompt import DEFAULT_JUDGE_INSTRUCTIONS

        seed = (
            Path(__file__).resolve().parents[3]
            / "ally-be/src/prompts/debrief_quality/judge_system.txt"
        )
        if not seed.exists():
            pytest.skip("ally-be is not checked out beside ally-ai")
        assert seed.read_text().strip() == DEFAULT_JUDGE_INSTRUCTIONS

    @pytest.mark.asyncio
    async def test_the_judge_sends_the_store_text(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief

        calls = dispatch_returns(_output())
        await judge_debrief(
            TRANSCRIPT, "You listened.", "en", instructions="LIVE INSTRUCTIONS"
        )
        assert calls["prompt"].endswith("LIVE INSTRUCTIONS")

    @pytest.mark.asyncio
    async def test_the_judge_falls_back_to_the_code_text(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief
        from app.core.debrief_quality.prompt import DEFAULT_JUDGE_INSTRUCTIONS

        calls = dispatch_returns(_output())
        await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert calls["prompt"].endswith(DEFAULT_JUDGE_INSTRUCTIONS)


class TestJudge:
    @pytest.mark.asyncio
    async def test_returns_a_complete_answer(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief

        calls = dispatch_returns(_output(hard_fails=["missed_risk_cue"]))
        output, model = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert model == "gemini-2.5-pro"
        assert len(output.dimensions) == 8
        assert output.hard_fails[0].code == "missed_risk_cue"
        assert calls["task"] == "debrief_quality_judge"
        assert calls["temperature"] == 0

    @pytest.mark.asyncio
    async def test_an_unaddressed_risk_cue_becomes_the_hard_fail(
        self, dispatch_returns
    ):
        # The model listed the cue as unaddressed but forgot the hard fail:
        # the rule follows from the list in code, not from its memory.
        from app.core.debrief_quality.judge import judge_debrief
        from app.core.debrief_quality.schemas import RiskCue

        out = _output()
        out.risk_cues = [
            RiskCue(turn_index=2, quote="no point", addressed_by_debrief=False)
        ]
        dispatch_returns(out)
        output, _ = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert [h.code for h in output.hard_fails] == ["missed_risk_cue"]
        assert output.hard_fails[0].evidence == "turn 2: no point"

    @pytest.mark.asyncio
    async def test_an_addressed_risk_cue_adds_nothing(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief
        from app.core.debrief_quality.schemas import RiskCue

        out = _output()
        out.risk_cues = [
            RiskCue(turn_index=2, quote="no point", addressed_by_debrief=True)
        ]
        dispatch_returns(out)
        output, _ = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert output.hard_fails == []

    @pytest.mark.asyncio
    async def test_the_hard_fail_is_not_doubled(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief
        from app.core.debrief_quality.schemas import RiskCue

        out = _output(hard_fails=["missed_risk_cue"])
        out.risk_cues = [
            RiskCue(turn_index=2, quote="no point", addressed_by_debrief=False)
        ]
        dispatch_returns(out)
        output, _ = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert [h.code for h in output.hard_fails] == ["missed_risk_cue"]

    @pytest.mark.asyncio
    async def test_a_missing_dimension_is_no_answer(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief

        dispatch_returns(_output(dimensions=DIMENSIONS[:7]))
        output, _ = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert output is None

    @pytest.mark.asyncio
    async def test_a_repeated_dimension_is_no_answer(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief

        dispatch_returns(_output(dimensions=DIMENSIONS[:7] + ["tone"]))
        output, _ = await judge_debrief(TRANSCRIPT, "You listened.", "en")
        assert output is None

    @pytest.mark.asyncio
    async def test_nothing_to_judge_makes_no_call(self, dispatch_returns):
        from app.core.debrief_quality.judge import judge_debrief

        calls = dispatch_returns(_output())
        assert (await judge_debrief(TRANSCRIPT, "   ", "en"))[0] is None
        assert (await judge_debrief([], "text", "en"))[0] is None
        assert calls == {}


class TestEndpoint:
    @pytest.fixture
    def client(self):
        from app.core.config import settings
        from app.main import app

        c = TestClient(app)
        c.headers.update({"x-api-key": settings.API.X_API_KEY})
        return c

    def test_empty_debrief_is_rejected(self, client):
        r = client.post(
            "/api/v1/debrief-quality/judge",
            json={"transcript": TRANSCRIPT, "debrief": " "},
        )
        assert r.status_code == 400

    def test_no_answer_comes_back_empty_not_zero(self, client, dispatch_returns):
        dispatch_returns(None)
        r = client.post(
            "/api/v1/debrief-quality/judge",
            json={"transcript": TRANSCRIPT, "debrief": "You listened."},
        )
        assert r.status_code == 200
        body = r.json()
        assert body["dimensions"] == [] and body["hard_fails"] == []
        assert body["judge_prompt_version"] == "v1"

    def test_the_endpoint_passes_the_store_instructions(self, client, dispatch_returns):
        calls = dispatch_returns(_output())
        r = client.post(
            "/api/v1/debrief-quality/judge",
            json={
                "transcript": TRANSCRIPT,
                "debrief": "You listened.",
                "judge_instructions": "LIVE INSTRUCTIONS",
            },
        )
        assert r.status_code == 200
        assert calls["prompt"].endswith("LIVE INSTRUCTIONS")
        # Same text, same series: the version label does not move.
        assert r.json()["judge_prompt_version"] == "v1"


class TestAgentLog:
    """The independent check is logged against the run (ally-be stores it):
    the exact message with the judge's instructions named, and the reply."""

    @pytest.mark.asyncio
    async def test_the_response_carries_the_call(self):
        from unittest.mock import patch

        from app.api.v1.endpoints import debrief_quality as ep
        from app.core.llm import dispatch

        async def gemini(**kw):
            dispatch._emit_usage("gemini", kw["model"], "t", (40, 9, 49))
            return _output()

        with (
            patch.object(dispatch.settings.GEMINI, "API_KEY", "g"),
            patch.dict(dispatch._GENERATORS, {"gemini": gemini}),
        ):
            res = await ep.judge(
                ep.DebriefQualityRequest(
                    transcript=TRANSCRIPT,
                    debrief="You listened.",
                    judge_instructions="JUDGE INSTRUCTIONS",
                )
            )
        assert res.log is not None
        assert "{{system_prompt}}" in res.log["input"]
        assert "JUDGE INSTRUCTIONS" not in res.log["input"]
        assert "<debrief>\nYou listened.\n</debrief>" in res.log["input"]
        assert res.log["prompt_inlined"] is True
        assert len(res.log["output"]["dimensions"]) == 8
        assert (res.log["tokens_in"], res.log["tokens_out"]) == (40, 9)
