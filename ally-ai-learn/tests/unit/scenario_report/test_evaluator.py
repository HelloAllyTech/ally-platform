"""Tests for the LLM-as-a-judge evaluator."""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from app.core.scenario_report.evaluator import (
    EvaluationResult,
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
        "prompts": None,
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

    def test_valid_metrics(self):
        result = EvaluationResult(
            metrics={"gradual_disclosure": 80, "difficulty_level": 70},
            report_markdown="# Report\nGood session.",
        )
        assert result.metrics["gradual_disclosure"] == 80
        assert result.metrics["difficulty_level"] == 70
        assert result.report_markdown == "# Report\nGood session."

    def test_clamps_above_100(self):
        result = EvaluationResult(
            metrics={"gradual_disclosure": 120, "difficulty_level": 200},
            report_markdown="",
        )
        assert result.metrics["gradual_disclosure"] == 100
        assert result.metrics["difficulty_level"] == 100

    def test_clamps_below_0(self):
        result = EvaluationResult(
            metrics={"gradual_disclosure": -10, "resistance": -50},
            report_markdown="",
        )
        assert result.metrics["gradual_disclosure"] == 0
        assert result.metrics["resistance"] == 0

    def test_boundary_values(self):
        result = EvaluationResult(
            metrics={"a": 0, "b": 100, "c": 50},
            report_markdown="",
        )
        assert result.metrics["a"] == 0
        assert result.metrics["b"] == 100
        assert result.metrics["c"] == 50

    def test_empty_metrics(self):
        result = EvaluationResult(metrics={}, report_markdown="")
        assert result.metrics == {}

    def test_dynamic_metric_keys(self):
        """Any metric keys from the prompt are accepted — no hardcoded fields."""
        result = EvaluationResult(
            metrics={"empathy": 88, "active_listening": 72, "rapport": 91},
            report_markdown="# Custom metrics",
        )
        assert result.metrics["empathy"] == 88
        assert result.metrics["active_listening"] == 72
        assert result.metrics["rapport"] == 91


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
            name=None,
            age=None,
            gender=None,
            profession=None,
            current_location=None,
            context=None,
            personality=None,
            tone=None,
            emotional_needs=None,
            starting_state=None,
            session_behavior_guidelines=None,
            custom_fields=None,
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
            {"name": "Field2", "value": ""},
            {"name": "", "value": "Value3"},
            {"name": "Field4"},
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
    async def test_empty_transcripts_returns_empty(self):
        result = await evaluate_transcript(
            transcripts=[],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )
        assert result == {"metrics": {}, "report_markdown": ""}

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_successful_evaluation_returns_metrics_and_markdown(
        self, mock_create_llm
    ):
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            metrics={
                "gradual_disclosure": 85,
                "difficulty_level": 78,
                "context_appropriateness": 88,
                "consistency": 80,
                "resistance": 75,
            },
            report_markdown="# Evaluation Report\n\nGood performance.",
        )
        # New mock chain: _build_evaluator_llm() returns a ChatOpenAI
        # directly (no `.llm_instance` indirection). Its
        # `.with_structured_output(...)` returns the structured-output
        # wrapped LLM that the evaluator awaits via `.ainvoke(...)`.
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        result = await evaluate_transcript(
            transcripts=[_make_transcript("Hello", "CLIENT")],
            prompt_data=_make_prompt_data(),
            counselor_prompt="Be supportive",
        )

        assert result["metrics"]["gradual_disclosure"] == 85
        assert result["metrics"]["difficulty_level"] == 78
        assert result["metrics"]["context_appropriateness"] == 88
        assert result["metrics"]["consistency"] == 80
        assert result["metrics"]["resistance"] == 75
        assert "# Evaluation Report" in result["report_markdown"]

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.resolve_template")
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_honors_per_prompt_openai_model_and_temperature(
        self, mock_build, mock_resolve
    ):
        """The selected evaluator prompt's OpenAI model + temperature apply."""
        mock_resolve.return_value = "Judge the transcript."
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            metrics={"x": 50}, report_markdown="r"
        )
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_build.return_value = mock_client

        pd = _make_prompt_data(
            prompts={
                "eval_judge": {
                    "prompt": "Judge the transcript.",
                    "provider": "openai",
                    "model": "gpt-4.1",
                    "temperature": 0.2,
                }
            }
        )

        await evaluate_transcript(
            transcripts=[_make_transcript("Hi", "CLIENT")],
            prompt_data=pd,
            counselor_prompt="x",
            selected_prompt_code="eval_judge",
        )

        mock_build.assert_called_once_with("gpt-4.1", 0.2)

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.resolve_template")
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_ignores_non_openai_model_but_keeps_temperature(
        self, mock_build, mock_resolve
    ):
        """A non-OpenAI evaluator model is ignored (json_mode judge is OpenAI);
        the temperature override still applies."""
        mock_resolve.return_value = "Judge the transcript."
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            metrics={"x": 50}, report_markdown="r"
        )
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_build.return_value = mock_client

        pd = _make_prompt_data(
            prompts={
                "eval_judge": {
                    "prompt": "Judge the transcript.",
                    "provider": "gemini",
                    "model": "gemini-2.5-flash",
                    "temperature": 0.4,
                }
            }
        )

        await evaluate_transcript(
            transcripts=[_make_transcript("Hi", "CLIENT")],
            prompt_data=pd,
            counselor_prompt="x",
            selected_prompt_code="eval_judge",
        )

        mock_build.assert_called_once_with(None, 0.4)

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_dynamic_metrics_passed_through(self, mock_create_llm):
        """Any metric keys returned by the LLM are preserved without code changes."""
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            metrics={"empathy": 90, "active_listening": 82, "rapport": 76},
            report_markdown="# Custom Report",
        )
        # New mock chain: _build_evaluator_llm() returns a ChatOpenAI
        # directly (no `.llm_instance` indirection). Its
        # `.with_structured_output(...)` returns the structured-output
        # wrapped LLM that the evaluator awaits via `.ainvoke(...)`.
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        assert result["metrics"] == {
            "empathy": 90,
            "active_listening": 82,
            "rapport": 76,
        }
        assert result["report_markdown"] == "# Custom Report"

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator.load_template")
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_passes_prompt_data_to_load_template(
        self, mock_create_llm, mock_load_template
    ):
        """prompt_data must be forwarded to load_template so the dashboard
        prompt override is used instead of the local .txt file."""
        mock_load_template.return_value = "You are an evaluator."
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(
            metrics={"consistency": 70}, report_markdown=""
        )
        # New mock chain: _build_evaluator_llm() returns a ChatOpenAI
        # directly (no `.llm_instance` indirection). Its
        # `.with_structured_output(...)` returns the structured-output
        # wrapped LLM that the evaluator awaits via `.ainvoke(...)`.
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        prompt_data = _make_prompt_data()
        await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=prompt_data,
            counselor_prompt="prompt",
        )

        mock_load_template.assert_called_once_with(
            "evaluation/evaluator_system", prompt_data
        )

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_llm_exception_returns_empty(self, mock_create_llm):
        mock_create_llm.side_effect = RuntimeError("LLM unavailable")

        result = await evaluate_transcript(
            transcripts=[_make_transcript("Hello", "CLIENT")],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        assert result == {"metrics": {}, "report_markdown": ""}

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_llm_invocation_failure_returns_empty(self, mock_create_llm):
        mock_llm = AsyncMock()
        mock_llm.ainvoke.side_effect = Exception("API timeout")
        # New mock chain: _build_evaluator_llm() returns a ChatOpenAI
        # directly (no `.llm_instance` indirection). Its
        # `.with_structured_output(...)` returns the structured-output
        # wrapped LLM that the evaluator awaits via `.ainvoke(...)`.
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        assert result == {"metrics": {}, "report_markdown": ""}

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_uses_json_mode_for_structured_output(self, mock_create_llm):
        """json_mode is required because OpenAI rejects arbitrary Dict schemas."""
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = EvaluationResult(metrics={}, report_markdown="")
        # New mock chain: _build_evaluator_llm() returns a ChatOpenAI
        # directly (no `.llm_instance` indirection). Its
        # `.with_structured_output(...)` returns the structured-output
        # wrapped LLM that the evaluator awaits via `.ainvoke(...)`.
        mock_client = MagicMock()
        mock_client.with_structured_output.return_value = mock_llm
        mock_create_llm.return_value = mock_client

        await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
        )

        # include_raw so the judge's token usage can be recorded.
        mock_client.with_structured_output.assert_called_once_with(
            EvaluationResult, method="json_mode", include_raw=True
        )


class TestReportEvaluationUsage:
    """AI-cost: the rehearsal judge's tokens reach llm_usage as
    scenario_report_evaluation. A rehearsal has no session, so the report id is
    the room (as for the rehearsal's graph-node calls) and the metadata."""

    @staticmethod
    def _raw():
        from langchain_core.messages import AIMessage

        return AIMessage(
            content="{}",
            usage_metadata={
                "input_tokens": 9000,
                "output_tokens": 900,
                "total_tokens": 9900,
                "input_token_details": {"cache_read": 4096},
            },
        )

    @staticmethod
    def _judge(ainvoke_result):
        mock_llm = AsyncMock()
        mock_llm.ainvoke.return_value = ainvoke_result
        mock_client = MagicMock()
        mock_client.model_name = "gpt-4o-mini"
        mock_client.with_structured_output.return_value = mock_llm
        return mock_client

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_records_against_the_report_id(
        self, mock_build, ai_usage_calls, graph_room
    ):
        judged = EvaluationResult(metrics={"consistency": 70}, report_markdown="# R")
        mock_build.return_value = self._judge(
            {"raw": self._raw(), "parsed": judged, "parsing_error": None}
        )

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
            report_id="rep-42",
        )

        assert result == {"metrics": {"consistency": 70}, "report_markdown": "# R"}
        _, kwargs = mock_build.return_value.with_structured_output.call_args
        assert kwargs == {"method": "json_mode", "include_raw": True}
        assert len(ai_usage_calls) == 1
        call = ai_usage_calls[0]
        assert call["task"] == "scenario_report_evaluation"
        # The report id, not whatever room context var happens to be set.
        assert call["room_id"] == "rep-42"
        assert call["metadata"] == {"report_id": "rep-42"}
        assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")
        assert (call["prompt_tokens"], call["completion_tokens"]) == (9000, 900)
        assert call["cached_tokens"] == 4096

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_parse_failure_records_then_returns_empty(
        self, mock_build, ai_usage_calls
    ):
        """Unchanged outcome (empty result -> FAILED webhook), but the tokens
        spent on the unparseable answer are recorded."""
        mock_build.return_value = self._judge(
            {
                "raw": self._raw(),
                "parsed": None,
                "parsing_error": ValueError("not json"),
            }
        )

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
            report_id="rep-1",
        )

        assert result == {"metrics": {}, "report_markdown": ""}
        assert [c["task"] for c in ai_usage_calls] == ["scenario_report_evaluation"]

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.evaluator._build_evaluator_llm")
    async def test_a_failing_emitter_does_not_fail_the_judge(
        self, mock_build, monkeypatch
    ):
        def _boom(*a, **k):
            raise RuntimeError("queue down")

        monkeypatch.setattr("app.core.llm_usage.emitter.emit_ai_usage", _boom)
        judged = EvaluationResult(metrics={"consistency": 70}, report_markdown="# R")
        mock_build.return_value = self._judge(
            {"raw": self._raw(), "parsed": judged, "parsing_error": None}
        )

        result = await evaluate_transcript(
            transcripts=[_make_transcript()],
            prompt_data=_make_prompt_data(),
            counselor_prompt="prompt",
            report_id="rep-1",
        )

        assert result["metrics"] == {"consistency": 70}
