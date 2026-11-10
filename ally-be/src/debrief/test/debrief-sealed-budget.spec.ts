import { DebriefTrialsService } from '../service/debrief-trials.service';

/** The monthly sealed run is paid from the learning budget and never spends past it. */
describe('the sealed run respects the learning budget', () => {
  function build(opts: {
    cases: number;
    budget: number;
    spent: number;
    typical: number | null;
    runCost: number;
  }) {
    const svc = Object.create(DebriefTrialsService.prototype) as any;
    const sessions = Array.from({ length: opts.cases }, (_, i) => `s${i}`);
    const run = jest.fn(async (id: string) => ({
      id: `run-${id}`,
      cards: { ok: true },
      estimatedCostUsd: opts.runCost,
    }));
    const recordLadderEvent = jest.fn(async () => undefined);
    Object.assign(svc, {
      settings: { get: jest.fn(async () => ({ sealedCases: opts.cases })) },
      testSets: { sessions: jest.fn(async () => sessions) },
      dataSource: { query: jest.fn(async () => [{ p50: opts.typical }]) },
      pmAgent: {
        learningBudgetThisMonth: jest.fn(async () => opts.budget),
        learningSpentThisMonth: jest.fn(async () => opts.spent),
        recordLadderEvent,
      },
      runner: { run },
      judge: { judge: jest.fn(async () => ({ overall: 9, hardFails: [] })) },
      logger: { warn: jest.fn(), info: jest.fn() },
    });
    return { svc, run, recordLadderEvent };
  }

  it('skips the whole run, and records why, when the budget left cannot cover it', async () => {
    // 60 × (0.10 + 0.04) = $8.40 needed, $5 left.
    const { svc, run, recordLadderEvent } = build({
      cases: 60,
      budget: 150,
      spent: 145,
      typical: 0.1,
      runCost: 0.1,
    });
    const r = await svc.sealedRun();
    expect(run).not.toHaveBeenCalled();
    expect(r).toMatchObject({
      status: 'skipped',
      reason: 'learning_budget',
      needUsd: 8.4,
      leftUsd: 5,
    });
    expect(recordLadderEvent).toHaveBeenCalledWith(r);
  });

  it('assumes the run ceiling per case when there is no production run to go by', async () => {
    // 60 × (0.50 + 0.04) = $32.40 needed, $30 left.
    const { svc, run } = build({
      cases: 60,
      budget: 30,
      spent: 0,
      typical: null,
      runCost: 0.1,
    });
    expect(await svc.sealedRun()).toMatchObject({ status: 'skipped' });
    expect(run).not.toHaveBeenCalled();
  });

  it('runs every case when it fits', async () => {
    const { svc, run } = build({
      cases: 10,
      budget: 150,
      spent: 0,
      typical: 0.1,
      runCost: 0.1,
    });
    const r = await svc.sealedRun();
    expect(run).toHaveBeenCalledTimes(10);
    expect(r).toMatchObject({ scored: 10, stoppedForBudget: 0 });
  });

  it('stops starting cases once real costs run past the estimate and the budget left', async () => {
    // Estimated 10 × 0.14 = $1.40 fits $2; each case really costs $0.54.
    const { svc, run } = build({
      cases: 10,
      budget: 2,
      spent: 0,
      typical: 0.1,
      runCost: 0.5,
    });
    const r = await svc.sealedRun();
    expect(run.mock.calls.length).toBeLessThan(10);
    expect(r.stoppedForBudget).toBe(10 - run.mock.calls.length);
    expect(r.costUsd).toBeLessThanOrEqual(2);
  });
});
