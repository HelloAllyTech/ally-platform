import {
  defaultOwnerSettings,
  ownerSettingProblem,
} from '../constants/debrief-owner-settings.constants';
import { DebriefReportingService } from '../service/debrief-reporting.service';
import { DebriefSettingsService } from '../service/debrief-settings.service';
import { bucket } from '../service/debrief-trials.service';
import {
  BaselineFacts,
  pairsFor,
  proposeOwnerSettings,
} from '../util/debrief-baseline.util';
import {
  canaryDecision,
  gateResult,
  LadderPair,
  quickTestResult,
  trialVerdict,
} from '../util/debrief-ladder.util';

const j = (overall: number | null, hardFails = 0) =>
  overall == null
    ? null
    : {
        overall,
        hardFails: Array.from({ length: hardFails }, () => ({ code: 'x' })),
      };
const pair = (
  b: number | null,
  c: number | null,
  bc = 0.1,
  cc = 0.1,
): LadderPair => ({
  base: j(b),
  chal: j(c),
  chalChecks: 0,
  baseCost: bc,
  chalCost: cc,
});
const settings = defaultOwnerSettings();

describe('the PM agent test ladder (v9 FR-52, FR-59)', () => {
  it('quick test: passes on the minimum lift with no new hard fails', () => {
    const up = [pair(7, 7.5), pair(7, 7.4), pair(8, 8.2), pair(6, 6.5)];
    expect(quickTestResult(up, 4, settings).passed).toBe(true);
    const flat = [pair(7, 7.1), pair(7, 7.0), pair(8, 8.0), pair(6, 6.1)];
    expect(quickTestResult(flat, 4, settings).passed).toBe(false);
    const halfScored = [
      pair(7, 9),
      pair(null, 9),
      pair(7, null),
      pair(null, null),
    ];
    expect(quickTestResult(halfScored, 4, settings).passed).toBe(false);
  });

  it('gate: each owner rule can fail it, and each can be switched off', () => {
    const better = [pair(7, 7.5), pair(7, 7.5), pair(8, 8.5)];
    expect(gateResult(better, 3, settings).passed).toBe(true);

    const pricey = [pair(7, 7.5, 0.1, 0.2), pair(7, 7.5, 0.1, 0.2)];
    const r = gateResult(pricey, 2, settings);
    expect(r.rules.cost).toBe(false);
    expect(r.passed).toBe(false);
    expect(
      gateResult(pricey, 2, { ...settings, gateMaxCostIncreasePct: 100 })
        .passed,
    ).toBe(true);

    const lower = [pair(8, 7.5), pair(8, 7.6)];
    expect(gateResult(lower, 2, settings).rules.median).toBe(false);
    expect(
      gateResult(lower, 2, { ...settings, gateJudgeMedianNotLower: false })
        .rules.median,
    ).toBe(true);

    const newFail: LadderPair[] = [
      { ...pair(7, 8), chal: j(8, 1) },
      pair(7, 8),
    ];
    expect(gateResult(newFail, 2, settings).rules.hardFails).toBe(false);
  });

  it('paired trial: runs until the minimum, then passes only when the interval sits at or above zero', () => {
    const probe = (b: number, c: number) => ({
      baseline: b,
      challenger: c,
      baselineHardFails: 0,
      challengerHardFails: 0,
    });
    const few = Array.from({ length: 5 }, () => probe(7, 8));
    expect(trialVerdict(few, settings).status).toBe('running');
    const better = Array.from({ length: 30 }, (_, i) =>
      probe(7, 7.5 + (i % 3) * 0.1),
    );
    const v = trialVerdict(better, settings);
    expect(v.status).toBe('passed');
    expect(v.lower).toBeGreaterThan(0);
    const noisy = Array.from({ length: 30 }, (_, i) =>
      probe(7, i % 2 ? 8 : 6.2),
    );
    expect(trialVerdict(noisy, settings).status).toBe('failed');
  });

  it('canary: reverts on a missed risk cue or when clearly worse, passes when not worse after runs and days', () => {
    const base = {
      canaryRuns: 30,
      controlRuns: 200,
      canaryMedian: 8.5,
      controlMedian: 8.4,
      canaryHardFailShare: 0.02,
      controlHardFailShare: 0.03,
      canaryMissedRiskCues: 0,
      days: 3,
    };
    expect(canaryDecision(base, settings).status).toBe('passed');
    expect(
      canaryDecision({ ...base, canaryMissedRiskCues: 1 }, settings).status,
    ).toBe('reverted');
    expect(
      canaryDecision({ ...base, canaryRuns: 15, canaryMedian: 7.5 }, settings)
        .status,
    ).toBe('reverted');
    expect(canaryDecision({ ...base, days: 1 }, settings).status).toBe(
      'running',
    );
  });

  it('canary membership is stable per session and spread evenly', () => {
    expect(bucket('s1')).toBe(bucket('s1'));
    const ins = Array.from(
      { length: 2000 },
      (_, i) => bucket(`s${i}`) < 0.1,
    ).filter(Boolean).length;
    expect(ins).toBeGreaterThan(150);
    expect(ins).toBeLessThan(250);
  });
});

describe('the baseline job proposes starting values from data', () => {
  const facts: BaselineFacts = {
    days: 28,
    runsPerDay: 20,
    liveRunsPerDay: 4,
    eligibleSessionsPerMonth: 600,
    byOrgLanguage: [],
    judge: { scored: 400, mean: 8.6, sd: 1.1, median: 8.8 },
    rejudge: { pairs: 8, sdOfDifference: 0.6 },
    hardFailRate: 0.04,
    costPerRunUsd: { p50: 0.12, p90: 0.2 },
    ideasTriedPerMonth: 3,
  };

  it('sizes each rung from the re-judging noise and says why', () => {
    const p = proposeOwnerSettings(facts, settings);
    // sd of paired differences = 1.5 × 0.6 = 0.9.
    // 7 pairs would do, but a quick test never goes below its minimum of 10.
    expect(p.quickTestCases!.value).toBe(Math.max(10, pairsFor(0.9, 1, 0.95)));
    expect(p.pairedMinComparisons!.value).toBe(pairsFor(0.9, 0.3, 0.95));
    expect(p.quickTestCases!.reason).toMatch(/Re-judging 8 debriefs/);
    expect(p.canaryShare!.reason).toMatch(/4\.0 live debriefs a day/);
    expect(p.learningBudgetUsd!.value).toBeGreaterThan(0);
    expect(p.learningBudgetUsd!.reason).toMatch(/3 ideas a month/);
    // The gate's rules and the confidence are the person's call.
    expect(p.gateNoNewHardFails).toBeUndefined();
    expect(p.pairedConfidence).toBeUndefined();
  });

  it('flags a setting that no longer fits the volume', () => {
    const tiny = { ...facts, eligibleSessionsPerMonth: 20 };
    const p = proposeOwnerSettings(tiny, { ...settings, gateCases: 100 });
    expect(p.gateCases!.value).toBeLessThan(50);
    expect(p.gateCases!.misfit).toBe(true);
  });

  it('never proposes outside a setting’s allowed range', () => {
    const noisy = { ...facts, rejudge: { pairs: 8, sdOfDifference: 5 } };
    const p = proposeOwnerSettings(noisy, settings);
    expect(p.pairedMinComparisons!.value).toBeLessThanOrEqual(1000);
  });
});

describe('owner settings (v9 FR-60)', () => {
  it('validates each value against its kind and range', () => {
    expect(ownerSettingProblem('gateCases', 100)).toBeNull();
    expect(ownerSettingProblem('gateCases', 10.5)).toMatch(/whole number/);
    expect(ownerSettingProblem('canaryShare', 0.6)).toMatch(/at most 0.3/);
    expect(ownerSettingProblem('gateNoNewHardFails', 1)).toMatch(
      /true or false/,
    );
    expect(ownerSettingProblem('nope', 1)).toMatch(/not a setting/);
  });

  function build(values: Record<string, unknown> = {}) {
    const row: any = { id: 1, values, proposal: null };
    const rows = {
      findOne: jest.fn(async () => row),
      save: jest.fn(async (r: any) => Object.assign(row, r)),
      create: (x: any) => x,
    };
    const audit = { log: jest.fn(async () => undefined) };
    return {
      svc: new DebriefSettingsService(rows as any, audit as any),
      row,
      audit,
    };
  }

  it('reads a person’s values over the defaults, ignoring a stored value that no longer validates', async () => {
    const { svc } = build({ gateCases: 120, canaryShare: 9 });
    const s = await svc.get();
    expect(s.gateCases).toBe(120);
    expect(s.canaryShare).toBe(0.1);
  });

  it('writes nothing when any change is refused, and audits what it changed', async () => {
    const { svc, row, audit } = build();
    await expect(
      svc.update({ gateCases: 120, canaryShare: 2 }, 7),
    ).rejects.toThrow(/canaryShare must be at most/);
    expect(row.values).toEqual({});
    await svc.update({ gateCases: 120, learningBudgetUsd: 200 }, 7);
    expect(row.values).toEqual({ gateCases: 120, learningBudgetUsd: 200 });
    expect(audit.log).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'DEBRIEF_SETTINGS_CHANGED',
        userId: 7,
        details: expect.objectContaining({
          changes: expect.objectContaining({
            learningBudgetUsd: { before: 150, after: 200 },
          }),
        }),
      }),
    );
    await svc.update({ gateCases: null }, 7);
    expect(row.values).toEqual({ learningBudgetUsd: 200 });
  });

  it('accepts only proposed values, and only when a person asks', async () => {
    const { svc, row } = build();
    row.proposal = {
      ranAt: '2026-11-10T00:00:00Z',
      facts: {},
      proposals: { gateCases: { value: 80, reason: 'r', misfit: false } },
    };
    await expect(svc.acceptBaseline(['quickTestCases'], 7)).rejects.toThrow(
      /no proposed value/,
    );
    await svc.acceptBaseline(['gateCases'], 7);
    expect(row.values.gateCases).toBe(80);
  });
});

describe('the PM agent reads only its redacted views (owner-approved, v9 G-4)', () => {
  const svc = new DebriefReportingService({} as any);

  it('refuses any other table, a refused column and anything but one SELECT, before running it', async () => {
    const run = jest.fn();
    (svc as any).executor = { run };
    for (const sql of [
      'SELECT * FROM debrief_runs',
      'SELECT content FROM debrief_reporting.runs',
      'DELETE FROM debrief_reporting.runs',
      'SELECT 1 FROM scenario_session_messages',
    ]) {
      const r = await svc.query(sql);
      expect(r.ok).toBe(false);
      expect(r.refused).toBeTruthy();
    }
    expect(run).not.toHaveBeenCalled();
  });

  it('runs a query over the views and caps what goes back to the model', async () => {
    const rows = Array.from({ length: 150 }, (_, i) => ({ n: i }));
    (svc as any).executor = {
      run: jest.fn(async () => ({ rows, truncated: false })),
    };
    const r = await svc.query(
      "SELECT language, count(*) AS n FROM debrief_reporting.runs WHERE mode = 'live' GROUP BY 1",
    );
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(100);
    expect(r.truncated).toBe(true);
  });
});
