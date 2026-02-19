"""Tests for scenario report Pydantic schemas."""

import pytest
from pydantic import ValidationError

from app.core.scenario_report.schemas import (
    ReportStatus,
    ScenarioReportRequest,
    ScenarioReportResponse,
    ScenarioReportWebhookPayload,
    TranscriptEntry,
)


class TestScenarioReportRequest:
    """Tests for the inbound request model."""

    def test_valid_request(self):
        req = ScenarioReportRequest(
            prompt="You are a counselor",
            turns=5,
            language="en-US",
            scenario_id=1,
            report_id="abc-123",
            metadata={"scenario": {}},
        )
        assert req.prompt == "You are a counselor"
        assert req.turns == 5
        assert req.language == "en-US"

    def test_turns_min_boundary(self):
        req = ScenarioReportRequest(
            prompt="p", turns=1, language="en", scenario_id=1,
            report_id="id", metadata={},
        )
        assert req.turns == 1

    def test_turns_below_min_raises(self):
        with pytest.raises(ValidationError):
            ScenarioReportRequest(
                prompt="p", turns=0, language="en", scenario_id=1,
                report_id="id", metadata={},
            )

    def test_missing_required_field_raises(self):
        with pytest.raises(ValidationError):
            ScenarioReportRequest(
                prompt="p", turns=5, language="en",
                # scenario_id missing
                report_id="id", metadata={},
            )


class TestScenarioReportResponse:
    """Tests for the immediate 202 response model."""

    def test_default_status_is_processing(self):
        resp = ScenarioReportResponse(scenario_id=1, report_id="abc")
        assert resp.status == ReportStatus.PROCESSING

    def test_serialization(self):
        resp = ScenarioReportResponse(scenario_id=42, report_id="r-1")
        data = resp.model_dump()
        assert data == {
            "scenario_id": 42,
            "report_id": "r-1",
            "status": "PROCESSING",
        }


class TestTranscriptEntry:
    """Tests for transcript entries."""

    def test_create_with_field_name(self):
        entry = TranscriptEntry(content="Hello", start_time=1.5, role="CLIENT")
        assert entry.content == "Hello"
        assert entry.start_time == 1.5
        assert entry.role == "CLIENT"

    def test_invalid_role_raises(self):
        with pytest.raises(ValidationError):
            TranscriptEntry(content="Hi", start_time=0, role="UNKNOWN")


class TestScenarioReportWebhookPayload:
    """Tests for the webhook payload model."""

    def _make_transcript(self, role="CLIENT"):
        return TranscriptEntry(content="msg", start_time=0.0, role=role)

    def test_completed_payload(self):
        payload = ScenarioReportWebhookPayload(
            metrics={"accuracy": 80, "empathy": 75, "engagement": 90},
            status=ReportStatus.COMPLETED,
            transcripts=[self._make_transcript()],
        )
        assert payload.status == ReportStatus.COMPLETED
        assert payload.metrics["accuracy"] == 80

    def test_failed_payload(self):
        payload = ScenarioReportWebhookPayload(
            metrics={}, status=ReportStatus.FAILED, transcripts=[],
        )
        assert payload.status == ReportStatus.FAILED
        assert payload.metrics == {}

