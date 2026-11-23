import { DEBRIEF_QUALITY_DIMENSIONS } from '../../analytics/constants/debrief-quality.constants';
import { defaultOwnerSettings } from '../constants/debrief-owner-settings.constants';
import {
  dimsOf,
  toScoredRun,
  uncoveredClearCue,
} from '../service/debrief-score.service';
import {
  mondays,
  qualityBreakdown,
  rollingSeries,
  ScoreRun,
  scoreWeightsOf,
} from '../util/debrief-score.util';

const w = scoreWeightsOf(defaultOwnerSettings());

const run = (week: string, over: Partial<ScoreRun> = {}) => ({
  week,
  quality: 8,
  pass: true,
  helpful: true,
  flagged: false,
  ...over,
});

describe('the improvement chart (rolling four weeks)', () => {
  it('lists every Monday, empty weeks included', () => {
    expect(mondays('2026-10-26', '2026-11-16')).toEqual([
      '2026-10-26',
      '2026-11-02',
      '2026-11-09',
      '2026-11-16',
    ]);
  });

  it('each point reads its week and the three before it, and no later week', () => {
    const runs = [
      run('2026-10-12', { pass: false }), // five weeks before 11-16: outside
      run('2026-10-26'),
      run('2026-11-09', { flagged: true }),
      run('2026-11-16', { helpful: false }),
    ];
    const [p1, p2] = rollingSeries(runs, ['2026-11-09', '2026-11-16'], w);
    // 11-09 reads 10-19 … 11-09: the 10-26 and 11-09 runs, and the 10-12 run is out.
    expect(p1).toMatchObject({
      week: '2026-11-09',
      n: 2,
      pass: 1,
      helpful: 1,
      notFlagged: 0.5,
    });
    expect(p2).toMatchObject({ n: 3, pass: 1, notFlagged: 0.667 });
    expect(p2.helpful).toBeCloseTo(2 / 3, 3);
    expect(p2.overall).not.toBeNull();
  });

  it('a window without debriefs has nulls, not zeros', () => {
    expect(rollingSeries([], ['2026-11-16'], w)[0]).toEqual({
      week: '2026-11-16',
      n: 0,
      overall: null,
      pass: null,
      helpful: null,
      notFlagged: null,
    });
  });
});

describe('the quality score in detail', () => {
  const dims = (o: Record<string, number>) =>
    Object.fromEntries(
      DEBRIEF_QUALITY_DIMENSIONS.map((d) => [d.dimension, o[d.dimension] ?? 9]),
    );

  it('averages each check over judged debriefs and sorts by what it costs the score', () => {
    const now = [
      run('w', { quality: 7, dims: dims({ actionability: 6, clarity: 5 }) }),
      run('w', { quality: 8, dims: dims({ actionability: 7, clarity: 5 }) }),
      run('w', { quality: null, dims: null }), // not judged: left out
    ];
    const q = qualityBreakdown(now, [], DEBRIEF_QUALITY_DIMENSIONS, 20);
    expect(q.current).toBe(7.5);
    expect(q.n).toBe(2);
    expect(q.previous).toBeNull();
    // Actionability 6.5 at 15% costs 0.53; clarity 5 at 5% only 0.25.
    expect(q.dimensions[0]).toMatchObject({
      key: 'actionability',
      score: 6.5,
      lost: 0.53,
    });
    const clarity = q.dimensions.find((d) => d.key === 'clarity');
    expect(clarity).toMatchObject({ score: 5, lost: 0.25 });
    expect(q.dimensions).toHaveLength(8);
  });

  it('compares with the window before only when both have enough judged debriefs', () => {
    const many = (n: number, quality: number) =>
      Array.from({ length: n }, () =>
        run('w', { quality, dims: dims({ tone: quality }) }),
      );
    const q = qualityBreakdown(
      many(20, 8),
      many(20, 7),
      DEBRIEF_QUALITY_DIMENSIONS,
      20,
    );
    expect(q.previous).toBe(7);
    expect(q.dimensions.find((d) => d.key === 'tone')?.previous).toBe(7);
    expect(
      qualityBreakdown(many(20, 8), many(19, 7), DEBRIEF_QUALITY_DIMENSIONS, 20)
        .previous,
    ).toBeNull();
  });

  it("reads the judge's dimension list from the run", () => {
    expect(
      dimsOf([
        { dimension: 'tone', score: 8 },
        { dimension: 'x', score: 'bad' },
      ]),
    ).toEqual({ tone: 8 });
    expect(dimsOf(null)).toBeNull();
  });
});

describe('the risk gate: a clear cue the learner was shown without', () => {
  const run = (over: Record<string, unknown>) =>
    toScoredRun({
      status: 'below_bar',
      has_cards: true,
      judged: true,
      quality: 9,
      hard_fails: [],
      shown: true,
      risk_cues: [],
      important_moment: null,
      ...over,
    });

  it('counts a clear cue the important moment does not cover', () => {
    expect(
      uncoveredClearCue([{ turn_index: 4, strength: 'clear' }], {
        turn_index: 9,
      }),
    ).toBe(true);
    // A cue with no strength is clear, as in ally-ai.
    expect(uncoveredClearCue([{ turn_index: 4 }], null)).toBe(true);
  });

  it('never counts a possible cue, nor a clear one the moment or its others cover', () => {
    // Prod 2026-11-13, f8f12995: three clear cues, all in the important moment; two possible ones flagged.
    const cues = [
      { turn_index: 4, strength: 'clear' },
      { turn_index: 6, strength: 'possible' },
      { turn_index: 15, strength: 'clear' },
      { turn_index: 19, strength: 'possible' },
      { turn_index: 22, strength: 'clear' },
    ];
    const moment = {
      turn_index: 22,
      others: [{ turn_index: 4 }, { turn_index: 15 }],
    };
    expect(uncoveredClearCue(cues, moment)).toBe(false);
    expect(
      uncoveredClearCue([{ turn_index: 12, strength: 'possible' }], null),
    ).toBe(false);
  });

  it("no longer reads the Evaluator's old review reason", () => {
    // Prod 2026-11-13, ef76926b: one possible cue, held as missed_risk_cue on release 7.
    expect(
      run({ risk_cues: [{ turn_index: 12, strength: 'possible' }] })
        .missedClearRiskCue,
    ).toBe(false);
  });

  it("also counts the judge's own missed clear risk cue, and only on a debrief the learner was shown", () => {
    expect(
      run({ hard_fails: [{ code: 'missed_risk_cue' }] }).missedClearRiskCue,
    ).toBe(true);
    expect(
      run({
        shown: false,
        status: 'failed',
        risk_cues: [{ turn_index: 1, strength: 'clear' }],
      }).missedClearRiskCue,
    ).toBe(false);
  });
});
