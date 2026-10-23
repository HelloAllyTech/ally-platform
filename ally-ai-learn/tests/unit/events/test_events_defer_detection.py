"""
Tests for EVENTS_OFF_GATE_DEFER_DETECTION (Phase 3): defer DETECTION of
non-reply-shaping events off the voice-to-voice critical path.

Covers (1) the config-time partition that decides which leaf events are
deferrable, and (2) orchestrate_deferred_events — the off-gate processor that
marks + scores + sends only its own events WITHOUT re-running the
registry/cascade/combination pass.
"""

from unittest.mock import AsyncMock, MagicMock

import pytest

from app.core.constants import DetectionType
from app.core.events.event_orchestrator.event_orchestrator import EventOrchestrator
from app.core.events.event_types.combination.constants import ExpressionNode


def _ev(event_id, detection_type, branching=False, data=None):
    e = MagicMock()
    e.event_id = event_id
    e.detection_type = detection_type
    e.branching_instruction = MagicMock() if branching else None
    e.data = data
    return e


def test_compute_deferrable_partition():
    """Only independent non-branching leaf classifiers are deferrable."""
    # Combination C = (A AND B), so A and B are combination-referenced -> must gate.
    expr = ExpressionNode(
        type="AND",
        left=ExpressionNode(type="IDENTIFIER", id="A"),
        right=ExpressionNode(type="IDENTIFIER", id="B"),
    )
    combo_data = MagicMock()
    combo_data.expression = expr

    events = [
        _ev("A", DetectionType.BINARY_CLASSIFIER),  # referenced by C -> gate
        _ev("B", DetectionType.BINARY_CLASSIFIER),  # referenced by C -> gate
        _ev(
            "C", DetectionType.COMBINATION, data=combo_data
        ),  # derived -> not deferrable
        _ev("D", DetectionType.BINARY_CLASSIFIER),  # independent non-branching -> DEFER
        _ev("E", DetectionType.BINARY_CLASSIFIER, branching=True),  # branching -> gate
        _ev("T", DetectionType.BINARY_CLASSIFIER),  # termination -> gate
        _ev("S", DetectionType.SCORE),  # not a classifier leaf -> gate
    ]

    deferrable = EventOrchestrator._compute_deferrable_detection_event_ids(
        events, termination_event_ids={"T"}
    )
    assert deferrable == {"D"}


def _make_orch(is_report_mode=False):
    scenario = MagicMock()
    scenario.events = []
    scenario.trigger_events = []
    scenario.termination_events = []
    return EventOrchestrator(
        scenario, room=MagicMock(), thread_id="t", is_report_mode=is_report_mode
    )


@pytest.mark.asyncio
async def test_orchestrate_deferred_sends_and_scores_without_core_pass():
    """Deferred path marks + sends + scores, and NEVER re-runs the core pass."""
    orch = _make_orch()
    ev = MagicMock()
    ev.event_id = "nb-1"

    orch._mark_deferred_leaf_detections = MagicMock()
    orch.event_registry = {"nb-1": MagicMock(happened=True)}
    orch._event_map = {"nb-1": ev}
    orch._filter_deferred_events_to_send = MagicMock(return_value=[ev])
    orch._collect_branching_and_feedback_data = MagicMock(return_value=["fb"])
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()
    # Guards: the subset-unsafe core-pass machinery must NOT run off-gate.
    orch.update = MagicMock(side_effect=AssertionError("update() ran off-gate"))
    orch._evaluate_and_handle_cascade_score_events = MagicMock(
        side_effect=AssertionError("cascade ran off-gate")
    )
    orch.get_happened_events = MagicMock(
        side_effect=AssertionError("get_happened_events ran off-gate")
    )

    feedback = await orch.orchestrate_deferred_events({"nb-1"}, room=MagicMock())

    orch._mark_deferred_leaf_detections.assert_called_once()
    orch._send_events_to_core.assert_awaited_once()
    assert [e.event_id for e in orch._send_events_to_core.await_args.args[0]] == [
        "nb-1"
    ]
    orch._update_event_score.assert_awaited_once()
    assert feedback == ["fb"]


@pytest.mark.asyncio
async def test_orchestrate_deferred_empty_is_noop():
    orch = _make_orch()
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()

    feedback = await orch.orchestrate_deferred_events(set(), room=MagicMock())

    assert feedback == []
    orch._send_events_to_core.assert_not_called()
    orch._update_event_score.assert_not_called()


def test_filter_deferred_respects_trigger_events_and_dedup():
    """The real deferred filter mirrors the main filter: trigger_events allowlist
    + trigger_multiple/_sent_events dedup."""
    orch = _make_orch()
    ev = MagicMock()
    ev.event_id = "nb-1"
    ev.detection_type = DetectionType.BINARY_CLASSIFIER
    orch.event_registry = {"nb-1": MagicMock(trigger_multiple=False)}
    orch._sent_events = set()

    # Empty trigger_events allowlist -> skip all (matches the main pass behavior).
    orch.trigger_events = set()
    assert orch._filter_deferred_events_to_send([ev], {"nb-1"}) == []

    # Allowlisted: first call sends + marks sent; second call is deduped
    # (trigger_multiple=False, already sent).
    orch.trigger_events = {"nb-1"}
    first = orch._filter_deferred_events_to_send([ev], {"nb-1"})
    assert [e.event_id for e in first] == ["nb-1"]
    assert "nb-1" in orch._sent_events
    assert orch._filter_deferred_events_to_send([ev], {"nb-1"}) == []


@pytest.mark.asyncio
async def test_orchestrate_deferred_report_mode_skips_send_but_scores():
    orch = _make_orch(is_report_mode=True)
    ev = MagicMock()
    ev.event_id = "nb-1"
    orch._mark_deferred_leaf_detections = MagicMock()
    orch.event_registry = {"nb-1": MagicMock(happened=True)}
    orch._event_map = {"nb-1": ev}
    orch._filter_deferred_events_to_send = MagicMock(return_value=[ev])
    orch._collect_branching_and_feedback_data = MagicMock(return_value=[])
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()

    await orch.orchestrate_deferred_events({"nb-1"}, room=MagicMock())

    orch._send_events_to_core.assert_not_called()  # report mode never sends to Core
    orch._update_event_score.assert_awaited_once()  # scoring still runs


# ---------------------------------------------------------------------------
# EVENTS_DEFER_NON_GATING_COMBINATIONS
# ---------------------------------------------------------------------------


def _combo(event_id, *refs, op="OR", branching=False):
    node = ExpressionNode(type="IDENTIFIER", id=refs[0])
    for ref in refs[1:]:
        node = ExpressionNode(
            type=op, left=node, right=ExpressionNode(type="IDENTIFIER", id=ref)
        )
    data = MagicMock()
    data.expression = node
    return _ev(event_id, DetectionType.COMBINATION, branching=branching, data=data)


def test_non_gating_combination_inputs_defer_only_with_the_flag(monkeypatch):
    """Prod: 34 combinations on the busiest scenarios, none branching, yet
    every input classifier held the reply."""
    from app.core.events.event_orchestrator import event_orchestrator as mod

    events = [
        _ev("A", DetectionType.BINARY_CLASSIFIER),
        _ev("B", DetectionType.BINARY_CLASSIFIER),
        _combo("C", "A", "B"),  # scores only
        _ev("X", DetectionType.BINARY_CLASSIFIER),
        _combo("N", "X"),  # non-branching, but nested in a branching one
        _combo("G", "N", branching=True),
        _ev("Y", DetectionType.BINARY_CLASSIFIER),
        _combo("T", "Y"),  # termination combination
    ]
    monkeypatch.setattr(mod.settings, "EVENTS_DEFER_NON_GATING_COMBINATIONS", False)
    off = EventOrchestrator._compute_deferrable_detection_event_ids(events, {"T"})
    assert off == set()

    monkeypatch.setattr(mod.settings, "EVENTS_DEFER_NON_GATING_COMBINATIONS", True)
    on = EventOrchestrator._compute_deferrable_detection_event_ids(events, {"T"})
    # A and B feed only a scoring combination; X feeds a branching one through
    # nesting, and Y a termination, so those stay on the gate.
    assert on == {"A", "B"}


def test_a_deferred_input_fires_its_combination_on_the_next_gate_pass(monkeypatch):
    """The registry persists across turns, so deferring is a one-turn lag."""
    from app.core.events.event_orchestrator import event_orchestrator as mod

    monkeypatch.setattr(mod, "is_event_eligible", lambda **kw: True)
    orch = _make_orch()
    combo = _combo("C", "A", "B", op="AND")
    orch._event_map = {"C": combo}
    orch.expression_list = [
        {
            "type": DetectionType.COMBINATION,
            "event_id": "C",
            "expression": combo.data.expression,
        }
    ]
    orch.event_registry = {}
    orch.set_event_state("A", False)
    orch.set_event_state("B", False)
    orch.set_event_state("C", False)

    orch.update(detected_event_ids={"A"})  # turn 1 gate: A on the gate
    orch.set_event_state("B", True)  # turn 1 deferred pass marks B, after the gate
    assert orch.event_registry["C"].happened is False
    orch.update(detected_event_ids=None)  # turn 2 gate: no new gating detections
    assert orch.event_registry["C"].happened is True


def _orch_with_combo(monkeypatch, expr_refs=("A", "B"), op="AND"):
    from app.core.events.event_orchestrator import event_orchestrator as mod

    monkeypatch.setattr(mod, "is_event_eligible", lambda **kw: True)
    orch = _make_orch()
    combo = _combo("C", *expr_refs, op=op)
    orch._event_map = {"C": combo}
    orch.expression_list = [
        {
            "type": DetectionType.COMBINATION,
            "event_id": "C",
            "expression": combo.data.expression,
        }
    ]
    orch.event_registry = {}
    for eid in (*expr_refs, "C"):
        orch.set_event_state(eid, False)
    orch.deferred_combination_ids = {"C"}
    orch.trigger_events = None
    orch.score_keeper = MagicMock(get_total_score=MagicMock(return_value=0))
    return orch, combo


def test_ready_deferred_combination_fires_once(monkeypatch):
    orch, combo = _orch_with_combo(monkeypatch)
    orch.set_event_state("A", True)
    assert orch.process_ready_deferred_combinations() == []  # B not yet
    orch.set_event_state("B", True)
    assert orch.process_ready_deferred_combinations() == [combo]
    assert orch.event_registry["C"].happened is True
    assert "C" in orch._sent_events
    assert orch.process_ready_deferred_combinations() == []  # never twice


@pytest.mark.asyncio
async def test_deferred_pass_fires_the_combination_in_the_same_turn(monkeypatch):
    """The checklist tick should land while the character is still speaking,
    not after the learner's next turn."""
    orch, combo = _orch_with_combo(monkeypatch, expr_refs=("A",), op="OR")
    leaf = _ev("A", DetectionType.BINARY_CLASSIFIER)
    leaf.detection_config = None
    orch._event_map["A"] = leaf
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()
    orch._collect_branching_and_feedback_data = MagicMock(return_value=[])

    await orch.orchestrate_deferred_events({"A"}, room=MagicMock())

    sent = [e.event_id for e in orch._send_events_to_core.await_args.args[0]]
    assert sent == ["A", "C"]
    orch._update_event_score.assert_awaited_once()


@pytest.mark.asyncio
async def test_shutdown_pass_is_a_safety_net(monkeypatch):
    from app.core.events.event_orchestrator import event_orchestrator as mod

    orch, combo = _orch_with_combo(monkeypatch, expr_refs=("A",), op="OR")
    orch._send_events_to_core = AsyncMock()
    orch._update_event_score = AsyncMock()
    orch.set_event_state("A", True)

    monkeypatch.setattr(mod.settings, "EVENTS_DEFER_NON_GATING_COMBINATIONS", False)
    assert await orch.evaluate_deferred_combinations() == 0
    monkeypatch.setattr(mod.settings, "EVENTS_DEFER_NON_GATING_COMBINATIONS", True)
    assert await orch.evaluate_deferred_combinations() == 1
    assert [e.event_id for e in orch._send_events_to_core.await_args.args[0]] == ["C"]
    assert await orch.evaluate_deferred_combinations() == 0  # dedup
