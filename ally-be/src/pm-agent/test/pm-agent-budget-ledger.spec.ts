import { PmAgentBudgetService } from '../service/pm-agent-budget.service';
import { planDegradation } from '../pipeline/pm-degrade';
import {
  actualCallUsd,
  estimateCallMaxUsd,
  PmRunLedger,
} from '../util/run-ledger';

describe('PmRunLedger (reserve-before-spend)', () => {
  it('refuses a step that would exceed the run cap and spends nothing for it', () => {
    const ledger = new PmRunLedger(1, 0);
    const a = ledger.reserve('lane', 'analytics', 0.6);
    expect(a).not.toBeNull();
    expect(ledger.reserve('lane', 'analytics', 0.5)).toBeNull();
    ledger.settle(a!, 0.2);
    expect(ledger.spent).toBe(0.2);
    expect(ledger.remainingUsd).toBe(0.8);
  });

  it('holds the critic share back from the lanes', () => {
    const ledger = new PmRunLedger(1, 0.2);
    expect(ledger.laneRemainingUsd).toBe(0.8);
    expect(ledger.reserve('lane', 'analytics', 0.81)).toBeNull();
    const lane = ledger.reserve('lane', 'analytics', 0.8)!;
    ledger.settle(lane, 0.8);
    // The lanes are out, the critic still has its share.
    expect(ledger.reserve('lane', 'code_health', 0.01)).toBeNull();
    expect(ledger.reserve('critic', 'critic', 0.2)).not.toBeNull();
  });

  it('caps each lane so one lane cannot starve the others', () => {
    const ledger = new PmRunLedger(1, 0);
    ledger.setLaneCount(4); // cap = max(1/4, 0.5) of the lane budget
    const first = ledger.reserve('lane', 'analytics', 0.5)!;
    expect(first).not.toBeNull();
    expect(ledger.reserve('lane', 'analytics', 0.01)).toBeNull();
    expect(ledger.reserve('lane', 'infra_cost', 0.4)).not.toBeNull();
  });

  it('release returns a reservation whole', () => {
    const ledger = new PmRunLedger(1, 0);
    const r = ledger.reserve('lane', 'analytics', 1)!;
    expect(ledger.remainingUsd).toBe(0);
    ledger.release(r);
    expect(ledger.remainingUsd).toBe(1);
    expect(ledger.spent).toBe(0);
  });

  it('prices unknown models high, never low', () => {
    const known = estimateCallMaxUsd('gpt-5-mini', 30_000, 4000);
    const unknown = estimateCallMaxUsd('some-new-model-x', 30_000, 4000);
    expect(unknown).toBeGreaterThan(known);
    expect(actualCallUsd('gpt-5-mini', 1000, 100)).toBeGreaterThan(0);
  });
});

describe('PmAgentBudgetService.runCapUsd', () => {
  it('is monthly ÷ 20, never more than what is left, zero when the month is used', () => {
    expect(PmAgentBudgetService.runCapUsd(100, 0, 20)).toBe(5);
    expect(PmAgentBudgetService.runCapUsd(100, 98, 20)).toBe(2);
    expect(PmAgentBudgetService.runCapUsd(100, 100, 20)).toBe(0);
    expect(PmAgentBudgetService.runCapUsd(100, 140, 20)).toBe(0);
  });
});

describe('planDegradation (skip lanes → cheaper model → fewer candidates → stop)', () => {
  const base = {
    fullLaneUsd: 1,
    cheapLaneUsd: 0.1,
    laneCount: 4,
    candidatesPerLane: 6,
  };

  it('runs everything when the budget covers it', () => {
    expect(planDegradation({ ...base, laneBudgetUsd: 5 })).toMatchObject({
      laneCount: 4,
      cheapModel: false,
      stop: false,
    });
  });

  it('first skips the lowest-weight lanes', () => {
    const plan = planDegradation({ ...base, laneBudgetUsd: 2.5 });
    expect(plan).toMatchObject({
      laneCount: 2,
      cheapModel: false,
      candidatesPerLane: 6,
    });
  });

  it('then switches to the cheaper model with fewer candidates', () => {
    const plan = planDegradation({ ...base, laneBudgetUsd: 0.25 });
    expect(plan).toMatchObject({
      laneCount: 2,
      cheapModel: true,
      candidatesPerLane: 3,
    });
  });

  it('finally stops', () => {
    expect(planDegradation({ ...base, laneBudgetUsd: 0.05 })).toMatchObject({
      laneCount: 0,
      stop: true,
    });
  });
});
