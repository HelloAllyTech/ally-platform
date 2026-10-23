"""
Tests for EVENTS_OFF_GATE — send only the reply-shaping events (branching +
guardrail + termination) to Core on the voice-to-voice critical path, and
fire-and-forget the non-branching ones off it. Score commit + termination
handling always run on the FULL event set on the gate; no-op in report mode.

Mirrors the structure of test_orchestrate_async_sqs.py (same seam).
"""

import asyncio
from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.config import settings
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator


def _event(event_id, branching=False):
    """A minimal event stub with the two attrs the partition predicate reads."""
    e = MagicMock()
    e.event_id = event_id
    e.branching_instruction = MagicMock() if branching else None
    return e


def _make_orchestrator(events_to_process, termination_ids=(), is_report_mode=False):
    scenario = MagicMock()
    scenario.events = []
    scenario.trigger_events = []
    scenario.termination_events = [MagicMock(id=tid) for tid in termination_ids]

    room = MagicMock()
    room.name = "test-room"

    orch = EventOrchestrator(
        scenario, room=room, thread_id="test-thread", is_report_mode=is_report_mode
    )
    # Isolate orchestrate_events from registry/scoring internals: the single
    # registry/cascade pass is mocked to return a fixed events_to_process list.
    orch._update_registry_and_collect_event_data = MagicMock(
        return_value=([], list(events_to_process), 0, [])
    )
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()
    orch._handle_termination_events = AsyncMock()
    return orch, room


@pytest.mark.asyncio
async def test_off_gate_partitions_sends(monkeypatch):
    """Branching + termination sent on-gate (awaited); non-branching backgrounded."""
    monkeypatch.setattr(settings, "EVENTS_OFF_GATE", True)
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", False)
    br = _event("br-1", branching=True)
    nb = _event("nb-1", branching=False)
    term = _event("term-1", branching=False)
    orch, room = _make_orchestrator([br, nb, term], termination_ids=["term-1"])

    await orch.orchestrate_events(room=room)
    # Drain the backgrounded non-branching send.
    await asyncio.gather(*list(orch._background_tasks))

    calls = orch._send_events_to_core.call_args_list
    gate_sent = {e.event_id for e in calls[0].args[0]}
    offgate_sent = {e.event_id for e in calls[1].args[0]}
    assert gate_sent == {"br-1", "term-1"}  # branching + termination on the gate
    assert offgate_sent == {"nb-1"}  # pure non-branching deferred off the gate
    assert not orch._background_tasks  # cleaned up after drain


@pytest.mark.asyncio
async def test_off_gate_nonbranching_termination_lands_on_gate(monkeypatch):
    """A termination event with NO branching_instruction must still gate."""
    monkeypatch.setattr(settings, "EVENTS_OFF_GATE", True)
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", False)
    term = _event("term-1", branching=False)
    orch, room = _make_orchestrator([term], termination_ids=["term-1"])

    await orch.orchestrate_events(room=room)
    if orch._background_tasks:
        await asyncio.gather(*list(orch._background_tasks))

    calls = orch._send_events_to_core.call_args_list
    assert {e.event_id for e in calls[0].args[0]} == {"term-1"}
    # No off-gate slice -> no second (background) send.
    assert len(calls) == 1
    assert not orch._background_tasks


@pytest.mark.asyncio
async def test_off_gate_score_and_termination_run_on_full_set(monkeypatch):
    """Scoring + termination always see the FULL event set, even off-gate."""
    monkeypatch.setattr(settings, "EVENTS_OFF_GATE", True)
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", False)
    br = _event("br-1", branching=True)
    nb = _event("nb-1", branching=False)
    orch, room = _make_orchestrator([br, nb])

    await orch.orchestrate_events(room=room)
    if orch._background_tasks:
        await asyncio.gather(*list(orch._background_tasks))

    orch._update_event_score.assert_awaited_once()
    assert {e.event_id for e in orch._update_event_score.await_args.args[0]} == {
        "br-1",
        "nb-1",
    }
    orch._handle_termination_events.assert_awaited_once()
    assert {e.event_id for e in orch._handle_termination_events.await_args.args[0]} == {
        "br-1",
        "nb-1",
    }


@pytest.mark.asyncio
async def test_off_gate_noop_in_report_mode(monkeypatch):
    """Report mode sends nothing, but still scores + handles termination."""
    monkeypatch.setattr(settings, "EVENTS_OFF_GATE", True)
    nb = _event("nb-1", branching=False)
    orch, room = _make_orchestrator([nb], is_report_mode=True)

    await orch.orchestrate_events(room=room)

    orch._send_events_to_core.assert_not_called()
    orch._update_event_score.assert_awaited_once()
    orch._handle_termination_events.assert_awaited_once()
    assert not orch._background_tasks


@pytest.mark.asyncio
async def test_flag_off_sends_full_set_inline(monkeypatch):
    """Flag off: original behavior — one awaited send of the full set, no split."""
    monkeypatch.setattr(settings, "EVENTS_OFF_GATE", False)
    monkeypatch.setattr(settings, "ORCHESTRATION_ASYNC_SQS", False)
    br = _event("br-1", branching=True)
    nb = _event("nb-1", branching=False)
    orch, room = _make_orchestrator([br, nb])

    await orch.orchestrate_events(room=room)

    orch._send_events_to_core.assert_awaited_once()
    assert {e.event_id for e in orch._send_events_to_core.await_args.args[0]} == {
        "br-1",
        "nb-1",
    }
    assert not orch._background_tasks
