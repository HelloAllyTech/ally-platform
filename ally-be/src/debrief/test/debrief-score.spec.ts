import {
  cumulativeScore,
  runScore,
  ScoreRun,
  scoreGates,
  scoreWeightsOf,
  sliceScore,
  trendOf,
  undoDecision,
  UNDO_MIN_RUNS,
} from '../util/debrief-score.util';
import { defaultOwnerSettings } from '../constants/debrief-owner-settings.constants';
import {
  gateRows,
  measureRow,
  toScoredRun,
  weekOf,
} from '../service/debrief-score.service';
import { slicesOf } from '../service/debrief-changes.service';

const w = scoreWeightsOf(defaultOwnerSettings());

const run = (over: Partial<ScoreRun> = {}): ScoreRun => ({
  quality: 8,
  pass: true,
  helpful: true,
  flagged: false,
  ...over,
});
const many = (n: number, over: Partial<ScoreRun> = {}) =>
  Array.from({ length: n }, () => run(over));

describe('the cumulative score (v2 S1)', () => {
  it('weights quality 40%, pass 25%, helpful 20%, flags 15% (lower is better), 0–10', () => {
    expect(w).toEqual({ quality: 0.4, pass: 0.25, helpful: 0.2, flags: 0.15 });
    // 0.4·0.8 + 0.25·1 + 0.2·1 + 0.15·(1−0) = 0.92
    expect(
      cumulativeScore({ quality: 8, pass: 1, helpful: 1, flags: 0 }, w),
    ).toBe(9.2);
    // Flags count the other way.
    expect(
      cumulativeScore({ quality: 8, pass: 1, helpful: 1, flags: 1 }, w),
    ).toBe(7.7);
  });

  it('re-weights over the measures with data; no quality score, no score', () => {
    // Nobody rated it: quality and pass only, re-normalised over 0.65 (+ flags).
    expect(
      cumulativeScore({ quality: 8, pass: 1, helpful: null, flags: null }, w),
    ).toBe(Math.round(((0.4 * 0.8 + 0.25) / 0.65) * 100) / 10);
    expect(
      cumulativeScore({ quality: null, pass: 1, helpful: 1, flags: 0 }, w),
    ).toBeNull();
    // Owner weights all zero: no score rather than a division by zero.
    expect(
      cumulativeScore(
        { quality: 8, pass: 1, helpful: 1, flags: 0 },
        { quality: 0, pass: 0, helpful: 0, flags: 0 },
      ),
    ).toBeNull();
  });

  it('per run and per slice', () => {
    expect(runScore(run(), w)).toBe(9.2);
    expect(runScore(run({ pass: false, flagged: true }), w)).toBe(5.2);
    expect(runScore(run({ helpful: null }), w)).toBe(
      Math.round(((0.4 * 0.8 + 0.25 + 0.15) / 0.8) * 100) / 10,
    );
    // A slice: mean quality, pass rate, helpful rate, flag rate.
    const slice = [run(), run({ quality: 6, pass: false, flagged: true })];
    // quality 7 → .7·.4 = .28; pass .5·.25; helpful 1·.2; flags .5 → .5·.15
    expect(sliceScore(slice, w)).toBe(
      Math.round((0.28 + 0.125 + 0.2 + 0.075) * 100) / 10,
    );
    expect(sliceScore([], w)).toBeNull();
  });

  it('trends say which way is better', () => {
    expect(trendOf(7.5, 7.2)).toEqual({ trend: 'up from 7.2', tone: 'up' });
    expect(trendOf(3, 5, false, 0.5)).toEqual({
      trend: 'down from 5',
      tone: 'up',
    });
    expect(trendOf(7.21, 7.2).tone).toBe('flat');
    expect(trendOf(null, 7).trend).toBe('no comparison yet');
  });
});

describe('the two gates (v2 S2)', () => {
  const g = (missed: boolean, cost: number | null = 0.3) => ({
    missedClearRiskCue: missed,
    sessionCostUsd: cost,
  });

  it('a missed clear risk cue trips the gate only when the comparison had none', () => {
    expect(scoreGates([g(false)], [g(false)], 1).risk.ok).toBe(true);
    expect(scoreGates([g(true)], [g(false)], 1).risk).toEqual({
      ok: false,
      missed: 1,
      before: 0,
    });
    expect(scoreGates([g(true)], [g(true)], 1).risk.ok).toBe(true);
    // No comparison: any is new.
    expect(scoreGates([g(true)], null, 1).risk.ok).toBe(false);
  });

  it('cost per session within the session budget, by its 90th percentile', () => {
    const runs = [
      ...Array.from({ length: 9 }, () => g(false, 0.4)),
      g(false, 3),
    ];
    const gates = scoreGates(runs, null, 1);
    expect(gates.cost).toMatchObject({ ok: true, p90Usd: 0.4, over: 1 });
    const pricey = scoreGates(
      Array.from({ length: 10 }, () => g(false, 1.2)),
      null,
      1,
    );
    expect(pricey.cost.ok).toBe(false);
    expect(scoreGates([], null, 1).cost).toMatchObject({
      ok: true,
      p90Usd: null,
    });
  });

  it('reads in plain words', () => {
    const rows = gateRows(scoreGates([g(true, 0.5)], [g(false)], 1));
    expect(rows.map((r) => r.label)).toEqual([
      'No missed clear risk cue',
      'Within the session budget',
    ]);
    expect(rows[0]).toMatchObject({
      ok: false,
      display: '1 debrief missed a clear risk cue this week',
    });
    expect(rows[1].display).toBe(
      '$0.50 a session (9 in 10 cost less), budget $1.00',
    );
  });
});

describe('the watch after going live (v2 A5)', () => {
  const ok = scoreGates([], null, 1);
  const slice = (
    language: string,
    after: ScoreRun[],
    before: ScoreRun[],
    recipe = 'standard',
  ) => ({ language, recipe, after, before });

  it('undoes when one language falls by more than the margin, with enough debriefs', () => {
    const d = undoDecision(
      [
        slice('en', many(40, { quality: 8 }), many(40, { quality: 8 })),
        slice('hi', many(40, { quality: 6 }), many(40, { quality: 8 })),
      ],
      ok,
      w,
      0.3,
    );
    expect(d.undo).toBe(true);
    expect(d.worst).toMatchObject({ language: 'hi', before: 9.2, after: 8.4 });
    expect(d.reason).toBe(
      'the score fell from 9.2 to 8.4 in Hindi (standard) over 40 debriefs',
    );
  });

  it('never undoes on a thin slice, a fall within the margin, or across languages', () => {
    expect(
      undoDecision(
        [slice('hi', many(UNDO_MIN_RUNS - 1, { quality: 2 }), many(40))],
        ok,
        w,
        0.3,
      ),
    ).toMatchObject({
      undo: false,
      reason: expect.stringMatching(/fewer than/),
    });
    expect(
      undoDecision(
        [slice('en', many(40, { quality: 7.8 }), many(40, { quality: 8 }))],
        ok,
        w,
        0.3,
      ).undo,
    ).toBe(false);
    // English before against Hindi after is never a comparison.
    const sliced = slicesOf(
      many(40, { quality: 5 }).map((r, i) => ({
        ...r,
        id: `a${i}`,
        createdAt: new Date(),
        week: '2026-11-09',
        language: 'hi',
        recipe: 'standard',
        releaseId: 'new',
        missedClearRiskCue: false,
        sessionCostUsd: 0.2,
      })),
      many(40, { quality: 9 }).map((r, i) => ({
        ...r,
        id: `b${i}`,
        createdAt: new Date(),
        week: '2026-11-02',
        language: 'en',
        recipe: 'standard',
        releaseId: 'old',
        missedClearRiskCue: false,
        sessionCostUsd: 0.2,
      })),
    );
    expect(sliced).toHaveLength(2);
    expect(undoDecision(sliced, ok, w, 0.3).undo).toBe(false);
  });

  it('a tripped gate undoes whatever the score says', () => {
    const tripped = scoreGates(
      [{ missedClearRiskCue: true, sessionCostUsd: 0.2 }],
      [{ missedClearRiskCue: false, sessionCostUsd: 0.2 }],
      1,
    );
    expect(undoDecision([], tripped, w, 0.3)).toMatchObject({
      undo: true,
      reason:
        '1 debrief was shown with a missed clear risk cue; the release before had none',
    });
    const cost = scoreGates(
      [{ missedClearRiskCue: false, sessionCostUsd: 2 }],
      null,
      1,
    );
    expect(undoDecision([], cost, w, 0.3).reason).toMatch(/session budget/);
  });
});

describe('score rows and measures (v2 S3)', () => {
  it('a row becomes a scored run with its pass, rating, flag and session cost', () => {
    const r = toScoredRun({
      id: 'r1',
      createdAt: '2026-11-10T10:00:00Z',
      status: 'published',
      week: '2026-11-10',
      language: 'ta',
      recipe: 'standard',
      releaseId: 'rel',
      has_cards: true,
      check_failures: [],
      judged: true,
      quality: '7.5',
      hard_fails: [],
      missed_clear: true,
      session_cost: '0.42',
      up: false,
      down: true,
      flagged: true,
    });
    expect(r).toMatchObject({
      quality: 7.5,
      pass: true,
      helpful: false,
      flagged: true,
      missedClearRiskCue: true,
      sessionCostUsd: 0.42,
    });
    // Not judged yet: out of the pass rate, no quality.
    expect(
      toScoredRun({
        status: 'published',
        has_cards: true,
        judged: false,
        quality: null,
      }),
    ).toMatchObject({ pass: null, quality: null, helpful: null });
  });

  it('measures show this week against the last, flags lower is better', () => {
    const now = { quality: 7.4, pass: 0.8, helpful: 0.6, flags: 0.02 };
    const before = { quality: 7.1, pass: 0.8, helpful: 0.7, flags: 0.05 };
    expect(measureRow('quality', 0.4, now, before)).toMatchObject({
      label: 'Quality score',
      display: '7.4 / 10',
      trend: 'up from 7.1',
      tone: 'up',
    });
    expect(measureRow('flags', 0.15, now, before)).toMatchObject({
      display: '2%',
      trend: 'down from 5%',
      tone: 'up',
    });
    expect(measureRow('helpful', 0.2, now, before).tone).toBe('down');
    expect(measureRow('pass', 0.25, now, before).trend).toBe('about the same');
    expect(
      measureRow('pass', 0.25, { ...now, pass: null }, before).display,
    ).toBe('No data yet');
  });

  it('weeks start on Monday', () => {
    expect(weekOf('2026-11-16T03:00:00Z')).toBe('2026-11-16');
    expect(weekOf('2026-11-15T23:00:00Z')).toBe('2026-11-09');
  });
});
