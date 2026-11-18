import { DEBRIEF_SEED_BUNDLE } from '../constants/debrief-release.constants';
import { GRAPH_MARGIN_MS } from '../service/debrief-graph.client';
import {
  REPUBLISH_AFTER_MINUTES,
  RESUME_AFTER_MINUTES,
  STUCK_AFTER_MINUTES,
} from '../service/debrief-agent.service';

/**
 * The numbers that must stay in order for a run never to be started twice: ally-ai cuts every call
 * off at deadline + margin (ally-ai `HARD_MARGIN_MS`, checked against this margin by
 * `ally-ai/tests/core/debrief_graph/test_deadline_margin.py`), ally-be stops waiting at the same
 * point, and only then may the sweeps treat a run as dead.
 */
describe('the debrief timing invariants', () => {
  const s = DEBRIEF_SEED_BUNDLE.settings;
  const hardEndMs = Math.max(s.deadlineMs, s.riskDeadlineMs) + GRAPH_MARGIN_MS;

  it('the margin is the one ally-ai cuts calls off at', () => {
    expect(GRAPH_MARGIN_MS).toBe(60_000);
  });

  it('a run is resumed only after ally-ai has certainly stopped', () => {
    expect(RESUME_AFTER_MINUTES * 60_000).toBeGreaterThan(hardEndMs);
  });

  it('a run is declared stuck only after it could have been resumed', () => {
    expect(STUCK_AFTER_MINUTES).toBeGreaterThan(RESUME_AFTER_MINUTES);
  });

  it('an unapplied debrief is published again only after the run has long finished', () => {
    expect(REPUBLISH_AFTER_MINUTES * 60_000).toBeGreaterThanOrEqual(2 * 60_000);
  });
});
