"""Chunk H1 Part A: the stage log and the test-only slow tool."""

import logging

import pytest

from app.core.agent_runtime import stages
from app.core.config import settings


@pytest.fixture(autouse=True)
def no_clock():
    """No run clock leaks into other tests."""
    token = stages._CLOCK.set(None)
    yield
    stages._CLOCK.reset(token)


@pytest.fixture
def delay(monkeypatch):
    def set_delay(seconds, env="DEVELOPMENT", when="before"):
        monkeypatch.setattr(settings.AGENT_RUNTIME, "DEBUG_TOOL_DELAY_SECONDS", seconds)
        monkeypatch.setattr(settings.AGENT_RUNTIME, "DEBUG_TOOL_DELAY_WHEN", when)
        monkeypatch.setattr(settings.ENV, "ENV", env)

    return set_delay


def test_the_delay_is_off_by_default():
    assert settings.AGENT_RUNTIME.DEBUG_TOOL_DELAY_SECONDS == 0
    assert stages.debug_tool_delay_seconds() == 0


@pytest.mark.parametrize("env", ["PROD", "prod", "PRODUCTION", "STG", "anything"])
def test_the_delay_is_ignored_outside_development_even_when_set(delay, env):
    delay(25, env=env)
    assert stages.debug_tool_delay_seconds() == 0


@pytest.mark.parametrize("env", ["DEV", "DEVELOPMENT", "development"])
def test_the_delay_applies_in_development_when_set(delay, env):
    delay(25, env=env)
    assert stages.debug_tool_delay_seconds() == 25


@pytest.mark.asyncio
async def test_production_never_sleeps(delay, monkeypatch):
    delay(25, env="PROD")
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(stages.asyncio, "sleep", fake_sleep)
    await stages.debug_tool_delay("before", "create_appointments")
    await stages.debug_tool_delay("after", "create_appointments")
    assert slept == []


@pytest.mark.asyncio
async def test_development_sleeps_only_on_the_chosen_side(delay, monkeypatch):
    delay(25, env="DEVELOPMENT", when="after")
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(stages.asyncio, "sleep", fake_sleep)
    await stages.debug_tool_delay("before", "create_appointments")
    await stages.debug_tool_delay("after", "create_appointments")
    assert slept == [25]


@pytest.mark.asyncio
async def test_the_delay_can_be_limited_to_some_tools(delay, monkeypatch):
    delay(25, env="DEVELOPMENT", when="after")
    monkeypatch.setattr(settings.AGENT_RUNTIME, "DEBUG_TOOL_DELAY_ONLY", "create_")
    slept = []

    async def fake_sleep(seconds):
        slept.append(seconds)

    monkeypatch.setattr(stages.asyncio, "sleep", fake_sleep)
    await stages.debug_tool_delay("after", "find_slots")
    await stages.debug_tool_delay("after", "create_appointments")
    assert slept == [25]


def test_a_stage_outside_a_run_logs_nothing(caplog):
    with caplog.at_level(logging.INFO):
        stages.stage("tool_start", tool="find_slots")
    assert "[AGENT STAGE]" not in caplog.text


def test_a_stage_inside_a_run_names_the_run_and_its_stage(caplog):
    with caplog.at_level(logging.INFO):
        clock = stages.begin("run-1")
        stages.stage("tool_start", active="tool:find_slots", tool="find_slots")
    assert "[AGENT STAGE] run=run-1 stage=tool_start t_ms=" in caplog.text
    assert "tool=find_slots" in caplog.text
    assert clock["active"] == "tool:find_slots"
