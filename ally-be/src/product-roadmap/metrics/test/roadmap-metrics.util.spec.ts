import {
  DAY_MS,
  IdeaTimeline,
  PolicyLogRow,
  bothThenLater,
  computeRoadmapMetrics,
  durationStats,
  earliest,
  funnelFor,
  furthestStep,
  quantile,
  releasesFor,
  resolveMetricsRange,
  reviewWaitFor,
  spendFor,
  stageTimesFor,
  workingDaysBetween,
} from '../roadmap-metrics.util';

const d = (iso: string) => new Date(`${iso}T00:00:00Z`);
const HOUR = 3_600_000;
const range = { from: d('2026-11-01'), to: d('2026-12-01') };

const idea = (over: Partial<IdeaTimeline> = {}): IdeaTimeline => ({
  capturedAt: null,
  submittedAt: null,
  reviewState: null,
  reviewedAt: null,
  planningAt: null,
  buildingAt: null,
  shippedAt: null,
  measuredAt: null,
  closed: false,
  ...over,
});

describe('resolveMetricsRange', () => {
  const now = new Date('2026-11-17T10:00:00Z');

  it('defaults to the 30 days before now', () => {
    const r = resolveMetricsRange({}, now);
    expect(r).toEqual({
      ok: true,
      from: new Date(now.getTime() - 30 * DAY_MS),
      to: now,
    });
  });

  it('reads a date-only `to` as the end of that day', () => {
    const r = resolveMetricsRange(
      { from: '2026-11-01', to: '2026-11-10' },
      now,
    );
    expect(r.ok && r.to.toISOString()).toBe('2026-11-11T00:00:00.000Z');
  });

  it('rejects junk, a reversed range and a range over two years', () => {
    expect(resolveMetricsRange({ from: 'soon' }, now).ok).toBe(false);
    expect(
      resolveMetricsRange({ from: '2026-11-10', to: '2026-11-01' }, now).ok,
    ).toBe(false);
    expect(
      resolveMetricsRange({ from: '2020-01-01', to: '2026-01-01' }, now).ok,
    ).toBe(false);
  });
});

describe('quantile and durationStats', () => {
  it('interpolates like percentile_cont', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(quantile([1, 2, 3, 4], 0.75)).toBe(3.25);
    expect(quantile([7], 0.75)).toBe(7);
    expect(quantile([], 0.5)).toBeNull();
  });

  it('does not depend on input order', () => {
    expect(durationStats([30, 10, 20])).toEqual({
      n: 3,
      medianMs: 20,
      p75Ms: 25,
    });
  });
});

describe('workingDaysBetween', () => {
  it('counts Monday to Friday only', () => {
    // Fri 2026-11-13 → Mon 2026-11-16: one working day (the Monday).
    expect(workingDaysBetween(d('2026-11-13'), d('2026-11-16'))).toBe(1);
    // Mon → next Mon: five.
    expect(workingDaysBetween(d('2026-11-09'), d('2026-11-16'))).toBe(5);
    expect(workingDaysBetween(d('2026-11-16'), d('2026-11-09'))).toBe(0);
  });
});

describe('furthestStep', () => {
  it('stops a declined idea at submitted', () => {
    expect(
      furthestStep(
        idea({ submittedAt: d('2026-11-02'), reviewState: 'declined' }),
      ),
    ).toBe(1);
  });

  it('reads a legacy row nobody reviewed as accepted, like deriveItemStage', () => {
    expect(furthestStep(idea({ submittedAt: d('2026-11-02') }))).toBe(2);
  });

  it('lets a later fact imply the earlier steps', () => {
    expect(furthestStep(idea({ shippedAt: d('2026-11-20') }))).toBe(3);
    expect(
      furthestStep(
        idea({
          submittedAt: d('2026-11-02'),
          reviewState: 'pending',
          planningAt: d('2026-11-03'),
        }),
      ),
    ).toBe(2);
  });
});

describe('funnelFor', () => {
  it('follows the cohort captured in the range, and counts draftless filings beside it', () => {
    const ideas = [
      idea({ capturedAt: d('2026-11-02') }), // still a draft
      idea({
        capturedAt: d('2026-11-03'),
        submittedAt: d('2026-11-03'),
        reviewState: 'pending',
      }),
      idea({
        capturedAt: d('2026-11-04'),
        submittedAt: d('2026-11-04'),
        reviewState: 'declined',
        reviewedAt: d('2026-11-05'),
      }),
      idea({
        capturedAt: d('2026-11-05'),
        submittedAt: d('2026-11-05'),
        reviewState: 'accepted',
        reviewedAt: d('2026-11-06'),
        shippedAt: d('2026-11-25'),
        measuredAt: d('2026-11-28'),
      }),
      // Captured before the range: not in this cohort, even though it shipped inside it.
      idea({
        capturedAt: d('2026-10-01'),
        submittedAt: d('2026-10-01'),
        reviewState: 'accepted',
        shippedAt: d('2026-11-10'),
      }),
      // Filed with no draft inside the range.
      idea({ submittedAt: d('2026-11-07') }),
      idea({ submittedAt: d('2026-10-07') }),
    ];
    expect(funnelFor(ideas, range)).toEqual({
      captured: 4,
      submitted: 3,
      accepted: 1,
      shipped: 1,
      measured: 1,
      filedWithoutDraft: 1,
    });
  });

  it('is all zeros for an empty range', () => {
    expect(funnelFor([], range)).toEqual({
      captured: 0,
      submitted: 0,
      accepted: 0,
      shipped: 0,
      measured: 0,
      filedWithoutDraft: 0,
    });
  });
});

describe('stageTimesFor', () => {
  it('counts moves that finished in the range, whenever they started', () => {
    const ideas = [
      idea({
        submittedAt: new Date(d('2026-10-30').getTime()),
        reviewState: 'accepted',
        reviewedAt: new Date(d('2026-11-02').getTime()),
        planningAt: new Date(d('2026-11-02').getTime() + 2 * HOUR),
        buildingAt: new Date(d('2026-11-04').getTime()),
        shippedAt: new Date(d('2026-12-05').getTime()), // after the range
      }),
      idea({
        submittedAt: d('2026-11-10'),
        reviewState: 'accepted',
        reviewedAt: new Date(d('2026-11-10').getTime() + HOUR),
      }),
    ];
    const stages = Object.fromEntries(
      stageTimesFor(ideas, range).map((s) => [s.key, s]),
    );
    expect(stages.submitted_accepted).toEqual({
      key: 'submitted_accepted',
      n: 2,
      medianMs: (3 * 24 * HOUR + HOUR) / 2,
      p75Ms: 3 * 24 * HOUR - (3 * 24 * HOUR - HOUR) / 4,
    });
    expect(stages.accepted_planning.n).toBe(1);
    expect(stages.accepted_planning.medianMs).toBe(2 * HOUR);
    expect(stages.planning_building.medianMs).toBe(46 * HOUR);
    expect(stages.building_shipped).toEqual({
      key: 'building_shipped',
      n: 0,
      medianMs: null,
      p75Ms: null,
    });
  });

  it('never times accepted → planning for a legacy row with no review time', () => {
    const stages = stageTimesFor(
      [idea({ submittedAt: d('2026-10-01'), planningAt: d('2026-11-05') })],
      range,
    );
    expect(stages.find((s) => s.key === 'accepted_planning')?.n).toBe(0);
  });

  it('drops a negative duration rather than reporting it', () => {
    const stages = stageTimesFor(
      [
        idea({
          planningAt: d('2026-11-10'),
          buildingAt: d('2026-11-05'),
        }),
      ],
      range,
    );
    expect(stages.find((s) => s.key === 'planning_building')?.n).toBe(0);
  });
});

describe('reviewWaitFor', () => {
  const now = new Date('2026-11-17T12:00:00Z'); // a Tuesday

  it('times reviews done in the range and counts the waits past amber now', () => {
    const wait = reviewWaitFor(
      [
        idea({
          submittedAt: d('2026-11-02'),
          reviewState: 'accepted',
          reviewedAt: d('2026-11-04'),
        }),
        idea({
          submittedAt: d('2026-11-03'),
          reviewState: 'declined',
          reviewedAt: d('2026-11-07'),
        }),
        // Waiting since Mon 2026-11-02: 11 working days, past 5.
        idea({ submittedAt: d('2026-11-02'), reviewState: 'pending' }),
        // Waiting since Mon 2026-11-16: 1 working day.
        idea({ submittedAt: d('2026-11-16'), reviewState: 'pending' }),
        // Closed while pending: not waiting.
        idea({
          submittedAt: d('2026-10-01'),
          reviewState: 'pending',
          closed: true,
        }),
      ],
      range,
      now,
      5,
    );
    expect(wait).toEqual({
      n: 2,
      medianMs: 3 * DAY_MS,
      p75Ms: 3.5 * DAY_MS,
      waitingNow: 2,
      overAmberNow: 1,
      amberDays: 5,
      longestWaitingMs: now.getTime() - d('2026-11-02').getTime(),
    });
  });

  it('has nothing to say when nothing was reviewed or waits', () => {
    expect(reviewWaitFor([], range, now, 5)).toEqual({
      n: 0,
      medianMs: null,
      p75Ms: null,
      waitingNow: 0,
      overAmberNow: 0,
      amberDays: 5,
      longestWaitingMs: null,
    });
  });
});

describe('releasesFor', () => {
  const row = (over: Partial<PolicyLogRow>): PolicyLogRow => ({
    kind: 'decision',
    mode: 'live',
    decision: 'held',
    outcome: null,
    healthy: null,
    service: 'be',
    at: d('2026-11-10'),
    ...over,
  });

  it('counts held decisions and failed or unhealthy releases in the range, by service', () => {
    const result = releasesFor(
      [
        row({}),
        row({ mode: 'shadow', service: 'frontend' }),
        row({ service: 'be' }),
        row({ at: d('2026-10-10') }), // outside
        row({ decision: 'release' }), // not held
        row({ kind: 'observed_release', decision: null, outcome: 'failed' }),
        row({
          kind: 'observed_release',
          decision: null,
          outcome: 'succeeded',
          healthy: false,
          service: 'ai',
        }),
        row({
          kind: 'observed_release',
          decision: null,
          outcome: 'succeeded',
          healthy: true,
        }),
      ],
      range,
      2,
    );
    expect(result).toEqual({
      held: {
        total: 3,
        shadow: 1,
        byService: [
          { service: 'be', count: 2 },
          { service: 'frontend', count: 1 },
        ],
      },
      failed: {
        total: 2,
        byService: [
          { service: 'ai', count: 1 },
          { service: 'be', count: 1 },
        ],
      },
      failingIdeasNow: 2,
    });
  });
});

describe('spendFor', () => {
  it('gives median, p75 and the top five, leaving out ideas with no spend', () => {
    const rows = [1, 2, 3, 4, 5, 6].map((n) => ({
      code: `OPP-000${n}`,
      title: n === 6 ? null : `Idea ${n}`,
      totalUsd: n * 1.111,
      approximate: n === 2,
    }));
    rows.push({
      code: 'OPP-0009',
      title: 'Nothing',
      totalUsd: 0,
      approximate: false,
    });
    const spend = spendFor(rows);
    expect(spend.ideas).toBe(6);
    expect(spend.totalUsd).toBe(23.33);
    expect(spend.medianUsd).toBe(3.89);
    expect(spend.p75Usd).toBe(5.28);
    expect(spend.approximate).toBe(true);
    expect(spend.top.map((r) => r.code)).toEqual([
      'OPP-0006',
      'OPP-0005',
      'OPP-0004',
      'OPP-0003',
      'OPP-0002',
    ]);
    // A private draft keeps its code and never gains a title.
    expect(spend.top[0]).toEqual({
      code: 'OPP-0006',
      title: null,
      totalUsd: 6.67,
      approximate: false,
    });
  });

  it('is empty, not zero-valued, with no spend', () => {
    expect(spendFor([])).toEqual({
      ideas: 0,
      totalUsd: 0,
      medianUsd: null,
      p75Usd: null,
      approximate: false,
      top: [],
    });
  });
});

describe('earliest and bothThenLater', () => {
  it('picks the first known date', () => {
    expect(earliest(null, d('2026-11-05'), undefined, d('2026-11-02'))).toEqual(
      d('2026-11-02'),
    );
    expect(earliest(null, undefined)).toBeNull();
  });

  it('needs both dates for a building-in-Claude-Code start', () => {
    expect(bothThenLater(d('2026-11-02'), null)).toBeNull();
    expect(bothThenLater(d('2026-11-02'), d('2026-11-04'))).toEqual(
      d('2026-11-04'),
    );
  });
});

describe('computeRoadmapMetrics', () => {
  it('puts the parts together with the range as ISO strings', () => {
    const now = new Date('2026-11-17T12:00:00Z');
    const result = computeRoadmapMetrics({
      range,
      now,
      amberDays: 5,
      ideas: [],
      policyLog: [],
      failingIdeasNow: 0,
      idleLeadReleases: 0,
      spend: [],
    });
    expect(result.range).toEqual({
      from: '2026-11-01T00:00:00.000Z',
      to: '2026-12-01T00:00:00.000Z',
    });
    expect(result.generatedAt).toBe(now.toISOString());
    expect(result.stages.map((s) => s.key)).toEqual([
      'submitted_accepted',
      'accepted_planning',
      'planning_building',
      'building_shipped',
    ]);
    expect(result.idleLeadReleases).toBe(0);
  });
});
