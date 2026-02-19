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

    @patch("app.core.scenario_report.service.ScenarioReportService.run", new_callable=AsyncMock)
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

    @patch("app.core.scenario_report.service.ScenarioReportService.run", new_callable=AsyncMock)
    def test_returns_202_with_processing_status(self, mock_run, client, valid_body, valid_headers):
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


