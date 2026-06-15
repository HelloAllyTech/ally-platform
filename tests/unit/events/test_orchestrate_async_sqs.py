"""
Tests for ORCHESTRATION_ASYNC_SQS — the fire-and-forget SQS latency lever.

When the flag is on, orchestrate_events must return without awaiting the
SQS send to Core (so it doesn't block the fan-in before generate_response);
when off, the send is awaited inline (original behavior).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import settings
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator


def _make_orchestrator():
    scenario = MagicMock()
    scenario.events = []
    scenario.trigger_events = []
    scenario.termination_events = []

    room = MagicMock()
    room.name = "test-room"

    orch = EventOrchestrator(scenario, room=room, thread_id="test-thread")
    # Isolate orchestrate_events from registry/scoring internals.
    evt = MagicMock()
    orch._update_registry_and_collect_event_data = MagicMock(
        return_value=([], [evt], 0, [])
    )
    orch._update_event_score = AsyncMock()
    orch._handle_termination_events = AsyncMock()
    return orch, room


@pytest.mark.asyncio
async def test_sync_path_awaits_send(monkeypatch):
    """Flag off: the SQS send is awaited inline, no background task left."""
    orch, room = _make_orchestrator()
    orch._send_events_to_core = AsyncMock()
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", False)

    await orch.orchestrate_events(room=room)

    orch._send_events_to_core.assert_awaited_once()
    assert not orch._background_tasks


@pytest.mark.asyncio
async def test_async_path_backgrounds_send(monkeypatch):
    """Flag on: orchestrate_events returns before the send completes."""
    orch, room = _make_orchestrator()

    release = asyncio.Event()

    async def _blocking_send(events, room):
        await release.wait()

    orch._send_events_to_core = AsyncMock(side_effect=_blocking_send)
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", True)

    await orch.orchestrate_events(room=room)

    # Returned without waiting for the (still-blocked) send: task is tracked
    # and has not finished yet.
    assert len(orch._background_tasks) == 1
    assert not release.is_set()

    # Let the background send finish and confirm it actually ran + cleaned up.
    release.set()
    await asyncio.gather(*list(orch._background_tasks))
    orch._send_events_to_core.assert_awaited_once()
    assert not orch._background_tasks


@pytest.mark.asyncio
async def test_async_path_logs_and_swallows_send_failure(monkeypatch):
    """A failing background send is observed (logged), never escapes."""
    orch, room = _make_orchestrator()
    orch._send_events_to_core = AsyncMock(side_effect=RuntimeError("sqs down"))
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", True)

    # Should not raise despite the send failing in the background.
    await orch.orchestrate_events(room=room)
    if orch._background_tasks:
        await asyncio.gather(*list(orch._background_tasks), return_exceptions=True)
    assert not orch._background_tasks
