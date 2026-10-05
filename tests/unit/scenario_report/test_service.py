"""Tests for the scenario report service."""

import time
from unittest.mock import AsyncMock, MagicMock, patch

import httpx
import pytest
from langchain_core.messages import AIMessage, HumanMessage

from app.core.events.base import BaseEvent
from app.core.scenario_report.schemas import (
    ReportStatus,
    ScenarioReportRequest,
    ScenarioReportWebhookPayload,
)
from app.core.scenario_report.service import ScenarioReportService

# ------------------------------------------------------------------
# Fixtures
# ------------------------------------------------------------------


def _make_request(**overrides) -> ScenarioReportRequest:
    defaults = {
        "prompt": "You are a counselor",
        "turns": 3,
        "language": "en-US",
        "scenario_id": 1,
        "report_id": "test-report-id",
        "metadata": {"scenario": {}},
    }
    defaults.update(overrides)
    return ScenarioReportRequest(**defaults)


def _make_event(event_id="evt-1") -> BaseEvent:
    mock_event = MagicMock(spec=BaseEvent)
    mock_event.event_id = event_id
    return mock_event


def _make_orchestrator(
    termination_message=None,
    event_id="evt-1",
):
    mock = MagicMock()
    mock.live_score = 85
    mock._scheduler = MagicMock()
    mock._scheduler.cancel_all = AsyncMock(return_value=0)
    mock.initialize = AsyncMock()

    if termination_message:
        term_config = MagicMock()
        term_config.termination_message = termination_message
        mock.get_termination_config.return_value = term_config
    else:
        mock.get_termination_config.return_value = None

    return mock


def _mock_load_and_format(internal_path, prompt_data=None, **kwargs):
    """Simulate load_and_format for counselor prompt (formats template with kwargs)."""
    return "Language: '{language_code}'\n\n{custom_prompt}".format(**kwargs)


# ------------------------------------------------------------------
# _record_transcript
# ------------------------------------------------------------------


class TestRecordTranscript:
    """Tests for the _record_transcript helper."""

    def test_first_entry_starts_at_zero(self):
        svc = ScenarioReportService(_make_request())
        svc._record_transcript("Hello", "CLIENT")

        assert len(svc._transcripts) == 1
        assert svc._transcripts[0].content == "Hello"
        assert svc._transcripts[0].role == "CLIENT"
        assert svc._transcripts[0].start_time == 0.0

    def test_subsequent_entries_have_increasing_time(self):
        svc = ScenarioReportService(_make_request())
        svc._record_transcript("First", "CLIENT")
        time.sleep(0.05)
        svc._record_transcript("Second", "COUNSELOR")

        assert len(svc._transcripts) == 2
        assert svc._transcripts[1].start_time > svc._transcripts[0].start_time
        assert svc._transcripts[1].role == "COUNSELOR"

    def test_multiple_entries(self):
        svc = ScenarioReportService(_make_request())
        for i in range(5):
            svc._record_transcript(f"msg-{i}", "CLIENT" if i % 2 == 0 else "COUNSELOR")

        assert len(svc._transcripts) == 5
        assert svc._transcripts[0].role == "CLIENT"
        assert svc._transcripts[1].role == "COUNSELOR"


# ------------------------------------------------------------------
# _extract_client_reply
# ------------------------------------------------------------------


class TestExtractClientReply:
    """Tests for extracting the client reply from graph output."""

    def test_extracts_last_ai_message(self):
        svc = ScenarioReportService(_make_request())
        output = {
            "messages": [
                HumanMessage(content="counselor said"),
                AIMessage(content="client response"),
            ]
        }
        assert svc._extract_client_reply(output) == "client response"

    def test_returns_last_ai_message_when_multiple(self):
        svc = ScenarioReportService(_make_request())
        output = {
            "messages": [
                AIMessage(content="first"),
                HumanMessage(content="middle"),
                AIMessage(content="latest"),
            ]
        }
        assert svc._extract_client_reply(output) == "latest"

    def test_returns_empty_when_no_ai_message(self):
        svc = ScenarioReportService(_make_request())
        output = {"messages": [HumanMessage(content="only human")]}
        assert svc._extract_client_reply(output) == ""

    def test_returns_empty_for_empty_messages(self):
        svc = ScenarioReportService(_make_request())
        assert svc._extract_client_reply({"messages": []}) == ""

    def test_returns_empty_for_no_messages_key(self):
        svc = ScenarioReportService(_make_request())
        assert svc._extract_client_reply({}) == ""

    def test_returns_empty_for_none_output(self):
        svc = ScenarioReportService(_make_request())
        assert svc._extract_client_reply(None) == ""


# ------------------------------------------------------------------
# _on_termination
# ------------------------------------------------------------------


class TestOnTermination:
    """Tests for the termination callback."""

    @pytest.mark.asyncio
    async def test_sets_terminated_flag(self):
        svc = ScenarioReportService(_make_request())
        event = _make_event("term-evt")

        await svc._on_termination(event)

        assert svc._terminated is True

    @pytest.mark.asyncio
    async def test_stores_termination_event(self):
        svc = ScenarioReportService(_make_request())
        event = _make_event("term-evt")

        await svc._on_termination(event)

        assert svc._termination_event is event
        assert svc._termination_event.event_id == "term-evt"


# ------------------------------------------------------------------


class TestBuildCounselorPrompt:
    """Tests for building the counselor prompt with language injection."""

    @patch("app.core.scenario_report.service.load_and_format")
    def test_injects_language_code_and_custom_prompt(self, mock_load):
        mock_load.side_effect = _mock_load_and_format
        svc = ScenarioReportService(_make_request())

        result = svc._build_counselor_prompt("hi-IN", "You are a therapist")

        assert "Language: 'hi-IN'" in result
        assert "You are a therapist" in result
        mock_load.assert_called_once_with(
            "counselor/report_generation_prompt",
            prompt_data=None,
            language_code="hi-IN",
            custom_prompt="You are a therapist",
        )

    @patch("app.core.scenario_report.service.load_and_format")
    def test_forwards_backend_prompts_to_resolver(self, mock_load):
        mock_load.return_value = "Speak Malayalam.\n\nExtra"
        svc = ScenarioReportService(_make_request())
        backend = {
            "ally_ai_learn_counselor_report_generation_prompt": "Speak Malayalam."
        }

        svc._build_counselor_prompt("en-IN", "Extra", backend_prompts=backend)

        mock_load.assert_called_once_with(
            "counselor/report_generation_prompt",
            prompt_data=backend,
            language_code="en-IN",
            custom_prompt="Extra",
        )


# ------------------------------------------------------------------
# _get_termination_message
# ------------------------------------------------------------------


class TestGetTerminationMessage:
    """Tests for resolving the termination message."""

    def test_returns_none_when_no_event(self):
        svc = ScenarioReportService(_make_request())
        orch = _make_orchestrator()
        assert svc._get_termination_message(orch) is None

    def test_returns_message_when_config_exists(self):
        svc = ScenarioReportService(_make_request())
        svc._termination_event = _make_event("evt-1")

        orch = _make_orchestrator(termination_message="Goodbye!")
        assert svc._get_termination_message(orch) == "Goodbye!"

    def test_returns_none_when_config_missing(self):
        svc = ScenarioReportService(_make_request())
        svc._termination_event = _make_event("evt-1")

        orch = _make_orchestrator(termination_message=None)
        assert svc._get_termination_message(orch) is None

    def test_returns_none_when_message_empty(self):
        svc = ScenarioReportService(_make_request())
        svc._termination_event = _make_event("evt-1")

        orch = MagicMock()
        term_config = MagicMock()
        term_config.termination_message = ""
        orch.get_termination_config.return_value = term_config

        assert svc._get_termination_message(orch) is None


# ------------------------------------------------------------------
# _send_webhook
# ------------------------------------------------------------------


class TestSendWebhook:
    """Tests for the webhook delivery."""

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.httpx.AsyncClient")
    async def test_sends_patch_request(self, mock_client_cls):
        mock_resp = MagicMock()
        mock_resp.status_code = 200
        mock_resp.raise_for_status = MagicMock()

        mock_client = AsyncMock()
        mock_client.patch.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        svc = ScenarioReportService(_make_request())
        payload = ScenarioReportWebhookPayload(
            metrics={"accuracy": 80, "empathy": 75, "engagement": 85},
            status="COMPLETED",
            transcripts=[],
        )

        await svc._send_webhook(payload)

        mock_client.patch.assert_called_once()
        call_kwargs = mock_client.patch.call_args
        assert "webhook" in call_kwargs.args[0]
        assert call_kwargs.kwargs["json"]["status"] == "COMPLETED"

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.asyncio.sleep", new_callable=AsyncMock)
    @patch("app.core.scenario_report.service.httpx.AsyncClient")
    async def test_handles_http_error(self, mock_client_cls, _sleep):
        mock_resp = MagicMock()
        mock_resp.status_code = 500
        mock_resp.text = "Internal Server Error"
        mock_resp.raise_for_status.side_effect = httpx.HTTPStatusError(
            "Server Error",
            request=MagicMock(),
            response=mock_resp,
        )

        mock_client = AsyncMock()
        mock_client.patch.return_value = mock_resp
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        svc = ScenarioReportService(_make_request())
        payload = ScenarioReportWebhookPayload(
            metrics={},
            status="FAILED",
            transcripts=[],
        )

        # Should not raise
        await svc._send_webhook(payload)

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.httpx.AsyncClient")
    async def test_handles_request_error(self, mock_client_cls):
        mock_client = AsyncMock()
        mock_client.patch.side_effect = httpx.RequestError("Connection timeout")
        mock_client.__aenter__ = AsyncMock(return_value=mock_client)
        mock_client.__aexit__ = AsyncMock(return_value=False)
        mock_client_cls.return_value = mock_client

        svc = ScenarioReportService(_make_request())
        payload = ScenarioReportWebhookPayload(
            metrics={},
            status="FAILED",
            transcripts=[],
        )

        # Should not raise
        await svc._send_webhook(payload)


# ------------------------------------------------------------------
# service.run() -- full lifecycle
# ------------------------------------------------------------------


class TestServiceRun:
    """Tests for the full run() lifecycle."""

    def _setup_mocks(self):
        """Create all the mocks needed for a service.run() invocation."""
        mock_scenario = MagicMock()
        mock_scenario.events = []
        mock_scenario.trigger_events = []
        mock_scenario.termination_events = []
        mock_scenario.prompt_data = _make_prompt_data()
        mock_scenario.language_config = None
        mock_scenario.behavior_instructions = None
        mock_scenario.state_instructions = None

        mock_graph = MagicMock()
        mock_graph.update_state = MagicMock()
        mock_graph.ainvoke = AsyncMock(
            return_value={
                "messages": [AIMessage(content="Client reply")],
            }
        )

        mock_counselor_llm = MagicMock()
        mock_counselor_resp = MagicMock()
        mock_counselor_resp.content = "Counselor response"
        mock_counselor_llm.llm_instance = MagicMock()
        mock_counselor_llm.llm_instance.ainvoke = AsyncMock(
            return_value=mock_counselor_resp
        )

        mock_orchestrator = _make_orchestrator()

        return mock_scenario, mock_graph, mock_counselor_llm, mock_orchestrator

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_happy_path_sends_completed(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 80,
                "difficulty_level": 75,
                "context_appropriateness": 90,
                "consistency": 78,
                "resistance": 70,
            },
            "report_markdown": "# Report\n\nGood session.",
        }

        svc = ScenarioReportService(_make_request(turns=2))

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            mock_webhook.assert_called_once()
            payload = mock_webhook.call_args.args[0]
            assert payload.status == ReportStatus.COMPLETED
            assert payload.metrics["gradual_disclosure"] == 80
            assert payload.metrics["difficulty_level"] == 75
            assert payload.metrics["context_appropriateness"] == 90
            assert payload.metrics["consistency"] == 78
            assert payload.metrics["resistance"] == 70
            assert payload.report_markdown == "# Report\n\nGood session."
            assert len(payload.transcripts) > 0

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_evaluation_failure_sends_failed(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 0,
                "difficulty_level": 0,
                "context_appropriateness": 0,
                "consistency": 0,
                "resistance": 0,
            },
            "report_markdown": "",
        }

        svc = ScenarioReportService(_make_request(turns=1))

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            mock_webhook.assert_called_once()
            payload = mock_webhook.call_args.args[0]
            assert payload.status == ReportStatus.FAILED

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_exception_sends_failed_webhook(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.side_effect = RuntimeError("Scenario parse error")

        svc = ScenarioReportService(_make_request())

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            mock_webhook.assert_called_once()
            payload = mock_webhook.call_args.args[0]
            assert payload.status == ReportStatus.FAILED
            assert payload.metrics == {}

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_termination_after_counselor_appends_message(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        """Time-based termination fires during counselor turn;
        termination message should be the last CLIENT entry."""
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()
        orchestrator.get_termination_config.return_value = MagicMock(
            termination_message="I have to go now.",
        )

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 70,
                "difficulty_level": 65,
                "context_appropriateness": 75,
                "consistency": 80,
                "resistance": 55,
            },
            "report_markdown": "",
        }

        svc = ScenarioReportService(_make_request(turns=5))

        # Simulate termination firing during counselor's LLM call
        original_ainvoke = counselor_llm.llm_instance.ainvoke

        async def terminate_during_counselor(*args, **kwargs):
            result = await original_ainvoke(*args, **kwargs)
            svc._terminated = True
            svc._termination_event = _make_event("term-evt")
            return result

        counselor_llm.llm_instance.ainvoke = AsyncMock(
            side_effect=terminate_during_counselor
        )

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            payload = mock_webhook.call_args.args[0]
            # Last transcript should be the termination message
            last = payload.transcripts[-1]
            assert last.role == "CLIENT"
            assert last.content == "I have to go now."

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_termination_during_graph_uses_term_message(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        """Event-based termination during graph invocation; termination
        message replaces the graph output."""
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()
        orchestrator.get_termination_config.return_value = MagicMock(
            termination_message="Session ending.",
        )

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 70,
                "difficulty_level": 65,
                "context_appropriateness": 75,
                "consistency": 80,
                "resistance": 55,
            },
            "report_markdown": "",
        }

        svc = ScenarioReportService(_make_request(turns=5))

        # Simulate termination firing during graph invocation
        original_graph_ainvoke = graph.ainvoke

        async def terminate_during_graph(*args, **kwargs):
            result = await original_graph_ainvoke(*args, **kwargs)
            svc._terminated = True
            svc._termination_event = _make_event("term-evt")
            return result

        graph.ainvoke = AsyncMock(side_effect=terminate_during_graph)

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            payload = mock_webhook.call_args.args[0]
            last = payload.transcripts[-1]
            assert last.role == "CLIENT"
            assert last.content == "Session ending."

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_cancels_pending_timers(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        """Verify that cancel_all is called on the scheduler after the loop."""
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()
        orchestrator._scheduler.cancel_all = AsyncMock(return_value=3)

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 80,
                "difficulty_level": 75,
                "context_appropriateness": 90,
                "consistency": 78,
                "resistance": 70,
            },
            "report_markdown": "",
        }

        svc = ScenarioReportService(_make_request(turns=1))

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock):
            await svc.run()

            orchestrator._scheduler.cancel_all.assert_awaited_once()

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_no_client_reply_skips_turn(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
    ):
        mock_load.side_effect = _mock_load_and_format
        """When graph returns no AI message, the turn is skipped."""
        scenario, graph, counselor_llm, orchestrator = self._setup_mocks()
        graph.ainvoke = AsyncMock(return_value={"messages": []})

        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {
            "metrics": {
                "gradual_disclosure": 50,
                "difficulty_level": 50,
                "context_appropriateness": 50,
                "consistency": 50,
                "resistance": 50,
            },
            "report_markdown": "",
        }

        svc = ScenarioReportService(_make_request(turns=2))

        with patch.object(svc, "_send_webhook", new_callable=AsyncMock) as mock_webhook:
            await svc.run()

            payload = mock_webhook.call_args.args[0]
            # Only opening (CLIENT) + counselor entries; no client entries from loop
            roles = [t.role for t in payload.transcripts]
            assert roles[0] == "CLIENT"  # opening
            for r in roles[1:]:
                assert r == "COUNSELOR"


# ------------------------------------------------------------------
# Helper used by service tests
# ------------------------------------------------------------------


def _make_prompt_data(**overrides):
    defaults = {
        "name": "Alice",
        "age": 30,
        "gender": "female",
        "profession": "Teacher",
        "current_location": "NYC",
        "context": "Anxious",
        "personality": "Shy",
        "tone": "Soft",
        "emotional_needs": "Validation",
        "starting_state": "Nervous",
        "session_behavior_guidelines": "Be realistic",
        "opening_statements": ["Hello!"],
    }
    defaults.update(overrides)
    mock = MagicMock()
    for k, v in defaults.items():
        setattr(mock, k, v)
    return mock


# ------------------------------------------------------------------
# Report-result webhook: bounded retry
# ------------------------------------------------------------------


def _webhook_client(*outcomes):
    """An httpx.AsyncClient stand-in whose successive PATCHes produce
    ``outcomes``: an int status code, or an exception to raise."""
    responses = []
    for outcome in outcomes:
        if isinstance(outcome, Exception):
            responses.append(outcome)
            continue
        resp = MagicMock()
        resp.status_code = outcome
        resp.text = "body"
        if outcome >= 400:
            resp.raise_for_status.side_effect = httpx.HTTPStatusError(
                "error", request=MagicMock(), response=resp
            )
        responses.append(resp)
    client = AsyncMock()
    client.patch.side_effect = responses
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    return client


class TestSendWebhookRetry:
    """A finished simulation + judge must not be thrown away on one transient
    webhook failure (the actor-evaluation webhook already retried)."""

    @staticmethod
    def _payload():
        return ScenarioReportWebhookPayload(
            metrics={"x": 80}, status="COMPLETED", transcripts=[]
        )

    async def _send(self, client):
        svc = ScenarioReportService(_make_request())
        with (
            patch(
                "app.core.scenario_report.service.httpx.AsyncClient",
                return_value=client,
            ),
            patch(
                "app.core.scenario_report.service.asyncio.sleep",
                new_callable=AsyncMock,
            ) as sleep,
        ):
            await svc._send_webhook(self._payload())
        return [c.args[0] for c in sleep.await_args_list]

    @pytest.mark.asyncio
    async def test_retries_a_5xx_then_delivers(self):
        client = _webhook_client(503, 200)
        sleeps = await self._send(client)
        assert client.patch.await_count == 2
        assert sleeps == [1.0]

    @pytest.mark.asyncio
    async def test_gives_up_after_three_attempts_with_backoff(self):
        client = _webhook_client(500, 502, 503)
        sleeps = await self._send(client)  # does not raise
        assert client.patch.await_count == 3
        assert sleeps == [1.0, 2.0]

    @pytest.mark.asyncio
    async def test_a_4xx_is_not_retried(self):
        client = _webhook_client(404)
        sleeps = await self._send(client)
        assert client.patch.await_count == 1
        assert sleeps == []

    @pytest.mark.asyncio
    async def test_retries_a_failure_to_connect(self):
        client = _webhook_client(httpx.ConnectError("refused"), 200)
        sleeps = await self._send(client)
        assert client.patch.await_count == 2
        assert sleeps == [1.0]

    @pytest.mark.asyncio
    async def test_a_read_timeout_is_not_retried(self):
        """The PATCH may have landed: Core appends transcripts, so resending
        could duplicate them."""
        client = _webhook_client(httpx.ReadTimeout("slow"))
        sleeps = await self._send(client)
        assert client.patch.await_count == 1
        assert sleeps == []


# ------------------------------------------------------------------
# Queued reports: cancel and duplicate triggers
# ------------------------------------------------------------------


class TestQueuedReports:
    """A report is registered when accepted, not when it starts running, so a
    cancel that lands while it waits for a slot stops it before any model call,
    and a repeated trigger for the same id cannot start a second run."""

    @staticmethod
    def _setup_patches():
        """Patch everything run() would touch after its early cancel check."""
        return (
            patch("app.core.scenario_report.service.OpenAIEmbeddingClient"),
            patch("app.core.scenario_report.service.Scenario"),
            patch("app.core.scenario_report.service.create_llm_client"),
            patch("app.core.scenario_report.service.evaluate_transcript"),
        )

    def test_a_second_accept_for_the_same_id_is_refused(self):
        from app.core.scenario_report.service import (
            _ACTIVE_REPORT_SERVICES,
            accept_report,
        )

        first = ScenarioReportService(_make_request(report_id="dup"))
        second = ScenarioReportService(_make_request(report_id="dup"))

        assert accept_report(first) is True
        assert accept_report(second) is False
        assert _ACTIVE_REPORT_SERVICES["dup"] is first

    @pytest.mark.asyncio
    async def test_cancel_while_queued_stops_before_any_model_call(self):
        import asyncio

        from app.core.scenario_report import service as report_service

        slot = asyncio.Semaphore(1)
        await slot.acquire()  # another report holds the only slot
        svc = ScenarioReportService(_make_request(report_id="queued"))
        assert report_service.accept_report(svc)

        embed_p, scenario_p, llm_p, eval_p = self._setup_patches()
        with (
            patch.object(report_service, "_get_report_semaphore", return_value=slot),
            patch.object(svc, "_send_webhook", new_callable=AsyncMock) as webhook,
            embed_p as embed,
            scenario_p as scenario,
            llm_p as create_llm,
            eval_p as evaluate,
        ):
            task = asyncio.create_task(
                report_service.run_report_with_concurrency_limit(svc)
            )
            await asyncio.sleep(0)  # now waiting for the slot

            # Before this change the cancel found nothing while queued.
            assert report_service.request_cancel("queued") is True

            slot.release()
            await task

        for setup in (embed, scenario.create, create_llm, evaluate):
            setup.assert_not_called()
        webhook.assert_awaited_once()
        payload = webhook.await_args.args[0]
        assert payload.status == ReportStatus.CANCELLED
        assert payload.transcripts == []
        assert "queued" not in report_service._ACTIVE_REPORT_SERVICES

    @pytest.mark.asyncio
    async def test_a_report_cancelled_while_waiting_frees_its_id(self):
        import asyncio

        from app.core.scenario_report import service as report_service

        slot = asyncio.Semaphore(1)
        await slot.acquire()
        svc = ScenarioReportService(_make_request(report_id="shutdown"))
        assert report_service.accept_report(svc)

        with patch.object(report_service, "_get_report_semaphore", return_value=slot):
            task = asyncio.create_task(
                report_service.run_report_with_concurrency_limit(svc)
            )
            await asyncio.sleep(0)
            task.cancel()
            with pytest.raises(asyncio.CancelledError):
                await task

        assert "shutdown" not in report_service._ACTIVE_REPORT_SERVICES

    @pytest.mark.asyncio
    async def test_a_finished_report_frees_its_id(self):
        import asyncio

        from app.core.scenario_report import service as report_service

        svc = ScenarioReportService(_make_request(report_id="done"))
        assert report_service.accept_report(svc)
        with (
            patch.object(
                report_service,
                "_get_report_semaphore",
                return_value=asyncio.Semaphore(1),
            ),
            patch.object(svc, "run", new_callable=AsyncMock),
        ):
            await report_service.run_report_with_concurrency_limit(svc)

        # A later trigger for the same id (a deliberate regenerate) runs.
        again = ScenarioReportService(_make_request(report_id="done"))
        assert report_service.accept_report(again) is True

    @pytest.mark.asyncio
    async def test_run_does_not_displace_the_accepted_instance(self):
        """run() on another instance with an accepted id must not take over
        the registry entry the cancel endpoint relies on, nor remove it."""
        from app.core.scenario_report import service as report_service

        accepted = ScenarioReportService(_make_request(report_id="same"))
        assert report_service.accept_report(accepted)
        other = ScenarioReportService(_make_request(report_id="same"))
        other.request_cancel()  # exit early, no setup
        with patch.object(other, "_send_webhook", new_callable=AsyncMock):
            await other.run()

        assert report_service._ACTIVE_REPORT_SERVICES["same"] is accepted


# ------------------------------------------------------------------
# AI usage (cost) of the rehearsal's own calls
# ------------------------------------------------------------------


class TestRehearsalUsage:
    """The simulated counsellor runs outside any graph node, so it records under
    the report id explicitly (the room the rehearsal's graph-node calls use)."""

    @pytest.mark.asyncio
    @patch("app.core.scenario_report.service.load_and_format")
    @patch("app.core.scenario_report.service.evaluate_transcript")
    @patch("app.core.scenario_report.service.EventOrchestrator")
    @patch("app.core.scenario_report.service.get_report_graph")
    @patch("app.core.scenario_report.service.create_llm_client")
    @patch("app.core.scenario_report.service.configure_llm_client")
    @patch("app.core.scenario_report.service.Scenario")
    @patch("app.core.scenario_report.service.OpenAIEmbeddingClient")
    async def test_each_counsellor_turn_records_under_the_report_id(
        self,
        mock_embed,
        mock_scenario_cls,
        mock_configure_llm,
        mock_create_llm,
        mock_get_graph,
        mock_orch_cls,
        mock_evaluate,
        mock_load,
        ai_usage_calls,
    ):
        mock_load.side_effect = _mock_load_and_format
        scenario, graph, counselor_llm, orchestrator = TestServiceRun()._setup_mocks()
        counselor_llm.provider = "openai"
        counselor_llm.llm_instance.model_name = "gpt-4o-mini"
        counselor_llm.llm_instance.ainvoke = AsyncMock(
            return_value=AIMessage(
                content="Counselor response",
                usage_metadata={
                    "input_tokens": 1200,
                    "output_tokens": 40,
                    "total_tokens": 1240,
                    "input_token_details": {"cache_read": 1024},
                },
            )
        )
        mock_embed.return_value = MagicMock()
        mock_scenario_cls.create.return_value = scenario
        mock_configure_llm.return_value = MagicMock()
        mock_create_llm.return_value = counselor_llm
        mock_get_graph.return_value.compile.return_value = graph
        mock_orch_cls.return_value = orchestrator
        mock_evaluate.return_value = {"metrics": {"x": 50}, "report_markdown": "# R"}

        svc = ScenarioReportService(_make_request(turns=2, report_id="rep-7"))
        with patch.object(svc, "_send_webhook", new_callable=AsyncMock):
            await svc.run()

        counsellor = [
            c for c in ai_usage_calls if c["task"] == "scenario_report_counselor"
        ]
        assert len(counsellor) == 2
        for call in counsellor:
            assert call["room_id"] == "rep-7"
            assert call["metadata"] == {"report_id": "rep-7"}
            assert (call["provider"], call["model"]) == ("openai", "gpt-4o-mini")
            assert call["prompt_tokens"] == 1200
            assert call["cached_tokens"] == 1024
        # The judge is told which report it is scoring, to record against it.
        assert mock_evaluate.await_args.kwargs["report_id"] == "rep-7"
