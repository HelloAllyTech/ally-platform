"""Tests for the scenario report API endpoint."""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi.testclient import TestClient

from app.core.config import settings
from app.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def valid_headers():
    return {"x-api-key": settings.X_API_KEY}


@pytest.fixture
def valid_body():
    return {
        "prompt": "You are a counselor helping someone with stress.",
        "turns": 5,
        "language": "en-US",
        "scenario_id": 1,
        "report_id": "f9e8d7c6-b5a4-3210-fedc-ba0987654321",
        "metadata": {
            "scenario": {
                "title": "Test",
                "promptData": {"name": "Test", "openingStatements": ["Hi"]},
                "events": [],
            }
        },
    }


class TestGenerateEndpointAuth:
    """Tests for authentication on the generate endpoint."""

    def test_missing_api_key_returns_422(self, client, valid_body):
        resp = client.post("/api/v1/scenario-report/generate", json=valid_body)
        assert resp.status_code == 422

    def test_invalid_api_key_returns_401(self, client, valid_body):
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers={"x-api-key": "wrong-key"},
        )
        assert resp.status_code == 401

    @patch(
        "app.core.scenario_report.service.ScenarioReportService.run",
        new_callable=AsyncMock,
    )
    def test_valid_api_key_passes(self, mock_run, client, valid_body, valid_headers):
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers=valid_headers,
        )
        assert resp.status_code == 202


class TestGenerateEndpointValidation:
    """Tests for request body validation."""

    def test_missing_prompt_returns_422(self, client, valid_headers, valid_body):
        del valid_body["prompt"]
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers=valid_headers,
        )
        assert resp.status_code == 422

    def test_turns_zero_returns_422(self, client, valid_headers, valid_body):
        valid_body["turns"] = 0
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers=valid_headers,
        )
        assert resp.status_code == 422

    def test_missing_metadata_returns_422(self, client, valid_headers, valid_body):
        del valid_body["metadata"]
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers=valid_headers,
        )
        assert resp.status_code == 422


class TestGenerateEndpointResponse:
    """Tests for the 202 response."""

    @patch(
        "app.core.scenario_report.service.ScenarioReportService.run",
        new_callable=AsyncMock,
    )
    def test_returns_202_with_processing_status(
        self, mock_run, client, valid_body, valid_headers
    ):
        resp = client.post(
            "/api/v1/scenario-report/generate",
            json=valid_body,
            headers=valid_headers,
        )
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "PROCESSING"
        assert body["scenario_id"] == valid_body["scenario_id"]
        assert body["report_id"] == valid_body["report_id"]


class TestGenerateEndpointDuplicates:
    """ally-be's trigger is wrapped in @RetryOnFail(3), so a retry after a slow
    first request can arrive while that report is queued or running."""

    def test_a_report_already_in_flight_is_not_started_again(
        self, client, valid_body, valid_headers
    ):
        from app.core.scenario_report.schemas import ScenarioReportRequest
        from app.core.scenario_report.service import (
            _ACTIVE_REPORT_SERVICES,
            ScenarioReportService,
            accept_report,
        )

        in_flight = ScenarioReportService(ScenarioReportRequest(**valid_body))
        assert accept_report(in_flight)

        with patch("app.api.scenario_report.spawn_background_task") as spawn:
            resp = client.post(
                "/api/v1/scenario-report/generate",
                json=valid_body,
                headers=valid_headers,
            )

        # Still a 2xx with the usual body: ally-be's caller only checks that.
        assert resp.status_code == 202
        body = resp.json()
        assert body["status"] == "PROCESSING"
        assert body["report_id"] == valid_body["report_id"]
        assert body["already_running"] is True
        spawn.assert_not_called()
        assert _ACTIVE_REPORT_SERVICES[valid_body["report_id"]] is in_flight

    def test_a_new_report_is_registered_before_it_is_spawned(
        self, client, valid_body, valid_headers
    ):
        from app.core.scenario_report.service import _ACTIVE_REPORT_SERVICES

        registered_at_spawn = {}

        def _spawn(coro, **kwargs):
            registered_at_spawn["ids"] = set(_ACTIVE_REPORT_SERVICES)
            coro.close()

        with patch("app.api.scenario_report.spawn_background_task", _spawn):
            resp = client.post(
                "/api/v1/scenario-report/generate",
                json=valid_body,
                headers=valid_headers,
            )

        assert resp.status_code == 202
        assert resp.json()["already_running"] is False
        # Registered on acceptance, so a cancel finds it while it is queued.
        assert valid_body["report_id"] in registered_at_spawn["ids"]
