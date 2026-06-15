"""Topology tests for BEHAVIORS_OFF_GATE (behaviors parallel to the reply)."""

from app.core.config import settings
from app.core.graph.graph_builder import build_simulation_graph

SYNC = "sync_events_and_behaviors_node"


def _edges():
    return set(build_simulation_graph().edges)


def test_default_behaviors_gate_the_response(monkeypatch):
    monkeypatch.setattr(settings, "BEHAVIORS_OFF_GATE", False)
    edges = _edges()
    # Behaviors converge at the pre-response sync (original behavior).
    assert ("detect_behaviors", SYNC) in edges
    assert ("detect_behaviors", "send_event_feedback") not in edges
    # process_events / retrieve_knowledge always gate.
    assert ("process_events", SYNC) in edges
    assert ("retrieve_knowledge", SYNC) in edges


def test_off_gate_routes_behaviors_parallel_to_response(monkeypatch):
    monkeypatch.setattr(settings, "BEHAVIORS_OFF_GATE", True)
    edges = _edges()
    # Behaviors no longer gate the response — they join at feedback instead.
    assert ("detect_behaviors", SYNC) not in edges
    assert ("detect_behaviors", "send_event_feedback") in edges
    # The response gate still waits on events + knowledge.
    assert ("process_events", SYNC) in edges
    assert ("retrieve_knowledge", SYNC) in edges
    # detect_behaviors still runs (kicked off from START).
    assert ("__start__", "detect_behaviors") in edges
