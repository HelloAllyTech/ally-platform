"""Shared fixtures for the scenario-report tests."""

import pytest


@pytest.fixture(autouse=True)
def _empty_report_registry():
    """Each test starts and ends with no queued or running report, so an id
    registered by one test (or left by an API test's background task) cannot
    read as a duplicate in another."""
    from app.core.scenario_report import service

    service._ACTIVE_REPORT_SERVICES.clear()
    yield
    service._ACTIVE_REPORT_SERVICES.clear()
