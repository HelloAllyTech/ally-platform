"""Tests for the LLM-as-a-judge evaluator."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.scenario_report.evaluator import (
    EvaluationResult,
    _SCORE_FIELDS,
    _build_evaluation_prompt,
    evaluate_transcript,
)
from app.core.scenario_report.schemas import TranscriptEntry


# ------------------------------------------------------------------
# Helpers
# ------------------------------------------------------------------

def _make_transcript(content="hi", role="CLIENT", start_time=0.0):
    return TranscriptEntry(content=content, start_time=start_time, role=role)


def _make_prompt_data(**overrides):
    defaults = {
        "name": "Alice",
        "age": 30,
        "gender": "female",
        "profession": "Teacher",
        "current_location": "NYC",
        "context": "Anxious about exams",
        "personality": "Shy",
        "tone": "Soft",
        "emotional_needs": "Validation",
        "starting_state": "Nervous",
        "session_behavior_guidelines": "Be realistic",
        "opening_statements": ["Hello!"],
        "custom_fields": None,
    }
    defaults.update(overrides)
    mock = MagicMock()
    for k, v in defaults.items():
        setattr(mock, k, v)
    return mock


# ------------------------------------------------------------------
# EvaluationResult model
# ------------------------------------------------------------------


class TestEvaluationResult:
    """Tests for the structured output model and clamping."""

    def test_valid_scores(self):
        result = EvaluationResult(
            gradual_disclosure=80,
            difficulty_level=70,
            colloquialism=90,
            context_appropriateness=85,
            consistency=75,
            resistance=65,
        )
        assert result.gradual_disclosure == 80
        assert result.difficulty_level == 70
        assert result.colloquialism == 90
        assert result.context_appropriateness == 85
        assert result.consistency == 75
        assert result.resistance == 65

    def test_clamps_above_100(self):
        result = EvaluationResult(
            gradual_disclosure=120,
            difficulty_level=150,
            colloquialism=200,
            context_appropriateness=110,
            consistency=105,
            resistance=300,
        )
        assert result.gradual_disclosure == 100
        assert result.difficulty_level == 100
        assert result.colloquialism == 100
        assert result.context_appropriateness == 100
        assert result.consistency == 100
        assert result.resistance == 100

    def test_clamps_below_0(self):
        result = EvaluationResult(
            gradual_disclosure=-10,
            difficulty_level=-50,
            colloquialism=-1,
            context_appropriateness=-20,
            consistency=-5,
            resistance=-100,
        )
        assert result.gradual_disclosure == 0
        assert result.difficulty_level == 0
        assert result.colloquialism == 0
        assert result.context_appropriateness == 0
        assert result.consistency == 0
        assert result.resistance == 0

    def test_boundary_values(self):
        result = EvaluationResult(
            gradual_disclosure=0,
            difficulty_level=100,
            colloquialism=50,
            context_appropriateness=25,
            consistency=75,
            resistance=100,
        )
        assert result.gradual_disclosure == 0
        assert result.difficulty_level == 100
        assert result.colloquialism == 50
        assert result.context_appropriateness == 25
        assert result.consistency == 75
        assert result.resistance == 100

    def test_score_fields_tuple(self):
        assert _SCORE_FIELDS == (
            "gradual_disclosure",
            "difficulty_level",
            "colloquialism",
            "context_appropriateness",
            "consistency",
            "resistance",
        )


# ------------------------------------------------------------------
# Prompt builder
# ------------------------------------------------------------------


class TestBuildEvaluationPrompt:
    """Tests for the evaluation prompt construction."""

    def test_includes_character_fields(self):
        prompt = _build_evaluation_prompt(
            transcripts=[_make_transcript("Hello", "CLIENT")],
            prompt_data=_make_prompt_data(),
            counselor_prompt="Be supportive",
        )
        assert "Name: Alice" in prompt
        assert "Age: 30" in prompt
        assert "Gender: female" in prompt
        assert "Profession: Teacher" in prompt
        assert "Location: NYC" in prompt

    def test_includes_counselor_prompt(self):
        prompt = _build_evaluation_prompt(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="You are a therapist",
        )
        assert "You are a therapist" in prompt

    def test_includes_transcript_content(self):
        transcripts = [
            _make_transcript("I feel anxious", "CLIENT", 0.0),
            _make_transcript("Tell me more", "COUNSELOR", 1.5),
        ]
        prompt = _build_evaluation_prompt(
            transcripts=transcripts,
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )
        assert "[CLIENT]: I feel anxious" in prompt
        assert "[COUNSELOR]: Tell me more" in prompt

    def test_empty_transcript_shows_fallback(self):
        prompt = _build_evaluation_prompt(
            transcripts=[],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )
        assert "No transcript available" in prompt

    def test_missing_prompt_data_fields(self):
        prompt_data = _make_prompt_data(
            name=None, age=None, gender=None, profession=None,
            current_location=None, context=None, personality=None,
            tone=None, emotional_needs=None, starting_state=None,
            session_behavior_guidelines=None, custom_fields=None,
        )
        prompt = _build_evaluation_prompt(
            transcripts=[_make_transcript()],
            prompt_data=prompt_data,
            counselor_prompt="prompt",
        )
        assert "No character details provided" in prompt

    def test_includes_custom_fields(self):
        custom_fields = [
            {"name": "Favorite Color", "value": "Blue"},
            {"name": "Pet Name", "value": "Fluffy"},
        ]
        prompt_data = _make_prompt_data(custom_fields=custom_fields)
        prompt = _build_evaluation_prompt(
            transcripts=[_make_transcript()],
            prompt_data=prompt_data,
            counselor_prompt="prompt",
        )
        assert "Favorite Color: Blue" in prompt
        assert "Pet Name: Fluffy" in prompt

    def test_custom_fields_with_missing_values(self):
        custom_fields = [
            {"name": "Field1", "value": "Value1"},
            {"name": "Field2", "value": ""},  # Empty value
            {"name": "", "value": "Value3"},  # Empty name
            {"name": "Field4"},  # Missing value key
        ]
        prompt_data = _make_prompt_data(custom_fields=custom_fields)
        prompt = _build_evaluation_prompt(
            transcripts=[_make_transcript()],
            prompt_data=prompt_data,
            counselor_prompt="prompt",
        )
        assert "Field1: Value1" in prompt
        assert "Field2:" not in prompt
        assert "Value3" not in prompt
        assert "Field4" not in prompt


# ------------------------------------------------------------------
# evaluate_transcript
# ------------------------------------------------------------------


class TestEvaluateTranscript:
    """Tests for the main evaluation function."""

    @pytest.mark.asyncio
    async def test_empty_transcripts_returns_zeros(self):
        result = await evaluate_transcript(
            transcripts=[],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )
        assert result == {
            "gradual_disclosure": 0,
            "difficulty_level": 0,
            "colloquialism": 0,
            "context_appropriateness": 0,
            "consistency": 0,
            "resistance": 0,
        }

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.create_llm_client")
    async def test_successful_evaluation(self, mock_create_llm):
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            gradual_disclosure=85,
            difficulty_level=78,
            colloquialism=92,
            context_appropriateness=88,
            consistency=80,
            resistance=75,
        )
        mock_client = MagicMock()
        mock_client.llm_instance.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        result = await evaluate_transcript(
            transcripts=[_make_transcript("Hello", "CLIENT")],
            prompt_data=_make_prompt_data(),
            counselor_prompt="Be supportive",
        )

        assert result["gradual_disclosure"] == 85
        assert result["difficulty_level"] == 78
        assert result["colloquialism"] == 92
        assert result["context_appropriateness"] == 88
        assert result["consistency"] == 80
        assert result["resistance"] == 75

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.create_llm_client")
    async def test_llm_exception_returns_zeros(self, mock_create_llm):
        mock_create_llm.side_effect = RuntimeError("LLM unavailable")

        result = await evaluate_transcript(
            transcripts=[_make_transcript("Hello", "CLIENT")],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        assert result == {
            "gradual_disclosure": 0,
            "difficulty_level": 0,
            "colloquialism": 0,
            "context_appropriateness": 0,
            "consistency": 0,
            "resistance": 0,
        }

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.create_llm_client")
    async def test_llm_invocation_failure_returns_zeros(self, mock_create_llm):
        mock_llm = AsyncMock()
        mock_llm.ainvoke.side_effect = Exception("API timeout")
        mock_client = MagicMock()
        mock_client.llm_instance.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        assert result == {
            "gradual_disclosure": 0,
            "difficulty_level": 0,
            "colloquialism": 0,
            "context_appropriateness": 0,
            "consistency": 0,
            "resistance": 0,
        }
