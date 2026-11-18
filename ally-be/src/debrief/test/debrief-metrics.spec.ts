import {
  pairedDifference,
  rate,
  skillKey,
  steeringScore,
  targetState,
  UptakeRun,
  uptakeLift,
  UPTAKE_MIN_PAIRS,
} from '../util/debrief-metrics.util';
import { DebriefLearnerEventsService } from '../service/debrief-learner-events.service';

const W = { judge: 0.5, practise: 0.25, thumbs: 0.25 };

describe('the weekly steering proxy (v9 §3.3)', () => {
  it('weights judge 50%, Practise-next click-through 25% and thumbs-up 25%, as 0–100', () => {
    // 0.5 × 0.9 + 0.25 × 0.4 + 0.25 × 0.8 = 0.75
    const s = steeringScore(9, rate(4, 10), rate(8, 10), W);
    expect(s.value).toBe(75);
    expect(s.missing).toEqual([]);
  });

  it('re-weights and says so when a component has no data that week', () => {
    // judge only for practise missing: (0.5 × 0.9 + 0.25 × 0.8) / 0.75
    const s = steeringScore(9, rate(0, 0), rate(8, 10), W);
    expect(s.missing).toEqual(['practise']);
    expect(s.value).toBeCloseTo(86.7, 1);
  });

  it('has no value without a judge score', () => {
    expect(steeringScore(null, rate(4, 10), rate(8, 10), W).value).toBeNull();
  });
});

describe('targets', () => {
  it('reads met, missed, thin and no data', () => {
    expect(targetState(0.9, { atLeast: 0.85 }, 40)).toBe('met');
    expect(targetState(0.5, { atLeast: 0.85 }, 40)).toBe('missed');
    expect(targetState(0.12, { atMost: 0.1 }, 40)).toBe('missed');
    expect(targetState(0.9, { atLeast: 0.85 }, 5)).toBe('thin');
    expect(targetState(null, { atLeast: 0.85 })).toBe('no_data');
  });
});

describe('uptake lift, the north star (v9 §3.3)', () => {
  const day = (d: number) => new Date(Date.UTC(2026, 10, 1 + d));
  const b = (
    skill: string,
    observation: 'observed' | 'partial' | 'missed',
  ) => ({
    skill,
    opportunity: true,
    observation,
  });
  /** One learner: "Reflections" targeted and improving, "Open questions" matched and flat. */
  const learner = (id: number, gapDays = 7): UptakeRun[] => [
    {
      learnerId: id,
      at: day(0),
      behaviours: [b('Reflections', 'missed'), b('Open questions', 'missed')],
      targeted: ['reflections.'],
    },
    {
      learnerId: id,
      at: day(gapDays),
      behaviours: [b('reflections', 'observed'), b('Open Questions', 'missed')],
      targeted: [],
    },
  ];

  it('compares a targeted skill with a matched untargeted one in the next session', () => {
    const runs = Array.from({ length: UPTAKE_MIN_PAIRS }, (_, i) =>
      learner(i),
    ).flat();
    const r = uptakeLift(runs);
    expect(r.insufficient).toBe(false);
    expect(r.pairs).toBe(UPTAKE_MIN_PAIRS);
    expect(r.lift).toBe(1);
  });

  it('says "insufficient data" below 150 pairs', () => {
    const r = uptakeLift(learner(1));
    expect(r).toMatchObject({ pairs: 1, lift: null, insufficient: true });
  });

  it('ignores a next session more than 14 days later, and skills without a match', () => {
    expect(uptakeLift(learner(1, 20)).pairs).toBe(0);
    const unmatched: UptakeRun[] = [
      {
        learnerId: 1,
        at: day(0),
        behaviours: [
          b('Reflections', 'missed'),
          b('Open questions', 'observed'),
        ],
        targeted: ['Reflections'],
      },
      {
        learnerId: 1,
        at: day(3),
        behaviours: [
          b('Reflections', 'observed'),
          b('Open questions', 'observed'),
        ],
        targeted: [],
      },
    ];
    expect(uptakeLift(unmatched).pairs).toBe(0);
  });

  it('matches skill names loosely: case, punctuation and spacing', () => {
    expect(skillKey(' Open-ended  Questions. ')).toBe('open ended questions');
  });
});

describe('learner events', () => {
  it('keeps only the platforms the apps send', () => {
    expect(DebriefLearnerEventsService.platform('ios')).toBe('ios');
    expect(DebriefLearnerEventsService.platform('windows')).toBeNull();
    expect(DebriefLearnerEventsService.platform(undefined)).toBeNull();
  });

  it('refuses anyone but the learner, and never throws when recording fails', async () => {
    const query = jest.fn(async (sql: string) => {
      if (sql.includes('scenario_sessions'))
        return [{ counselor_id: 7, tenant_id: 't1' }];
      if (sql.includes('debrief_runs')) return [{ id: 'r1' }];
      throw new Error('db down');
    });
    const svc = new DebriefLearnerEventsService({ query } as any);
    await expect(
      svc.recordForLearner('s1', 8, 'practise_next_click', 'web'),
    ).rejects.toThrow(/Not your session/);
    await expect(
      svc.recordForLearner('s1', 7, 'practise_next_click', 'web'),
    ).resolves.toEqual({ ok: true });
  });
});

/** Checked against the evals skill's eval_stats.py on the 2026-11-11 dev run. */
describe('rates carry intervals; paired comparisons count both directions', () => {
  it('Wilson matches the reference implementation', () => {
    expect(rate(28, 30)).toMatchObject({
      value: 0.933,
      low: 0.787,
      high: 0.982,
    });
    expect(rate(24, 30)).toMatchObject({ value: 0.8, low: 0.627, high: 0.905 });
    expect(rate(0, 0)).toMatchObject({ value: null, low: null, high: null });
  });

  it('a paired difference reports better, worse, its interval and exact McNemar p', () => {
    const pairs = [
      ...Array.from({ length: 24 }, () => ({ a: true, b: true })),
      ...Array.from({ length: 4 }, () => ({ a: true, b: false })),
      ...Array.from({ length: 2 }, () => ({ a: false, b: false })),
    ];
    const d = pairedDifference(pairs);
    expect(d).toMatchObject({ n: 30, better: 0, worse: 4, diff: -0.133 });
    expect(d.high!).toBeLessThan(0);
    // eval_stats: McNemar exact p = 0.125 — not conclusive on 4 discordant cases.
    expect(d.mcnemarP).toBe(0.125);
  });

  it('no pairs is no comparison, not a zero', () => {
    expect(pairedDifference([])).toMatchObject({ diff: null, mcnemarP: null });
  });
});
