"""ally-ai cuts every model call off where ally-be gives up on a run.

ally-be's HTTP timeout is `deadlineMs + GRAPH_MARGIN_MS` (ally-be `debrief-graph.client.ts`, 60 s).
ally-be's `debrief-timing-invariants.spec.ts` checks its side; this keeps ours the same number, so
a run is never still being paid for after ally-be started it again.
"""

from app.core.debrief_graph import constants


def test_the_hard_margin_matches_ally_bes_graph_margin():
    assert constants.HARD_MARGIN_MS == 60_000.0
