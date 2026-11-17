import 'reflect-metadata';
import { validateCardPayload } from '../dto/pm-card-payload.dto';
import {
  PmCardCategory,
  PmCardKind,
  PmDecision,
  PmLane,
} from '../enum/pm-agent.enum';
import { deterministicGate } from '../gate/pm-gate';
import { checkCandidate } from '../lane/pm-candidate';
import { computeLearnedStats, statKey } from '../learning/pm-lane-selector';
import { pickExemplars } from '../learning/pm-context';
import { PmEvidenceRef, PmOutcomeRow } from '../pipeline/pm-pipeline.types';
import { PmAgentEventsService } from '../service/pm-agent-events.service';
import { compilePlan } from '../util/compile-plan';
import {
  metricCatalogBlock,
  metricRefProblems,
  PM_METRIC_CATALOG,
  PM_METRIC_KEYS,
  PmMetricSources,
  readMetric,
} from '../impact/metric-catalog';
import {
  formatMetricValue,
  impactSchedule,
  impactSummary,
  impactVerdict,
  PM_IMPACT,
} from '../impact/impact-verdict';
import { PmAgentImpactService } from '../impact/pm-agent-impact.service';
import {
  PmImpactRow,
  PmImpactRowInsert,
  PmImpactRowPatch,
  PmImpactStorePort,
} from '../impact/pm-impact.store';
import { makeCard, recommendationPayload } from './pm-agent.fakes';
import { recFor } from './pm-pipeline.fakes';

const E1 = '0b7e7c1e-2f7a-4a43-9a6b-2a6d1f1c0001';

/** Sources whose figures are set per test; every call is recorded. */
class FakeSources implements PmMetricSources {
  calls: { name: string; arg: unknown; task?: string }[] = [];
  fail: Error | null = null;
  completion = { started: 100, completionRatePct: 40 as number | null };
  overviewSummary = {
    activeUsers: 50,
    simulationsCompleted: 300,
    retentionRatePct: 38 as number | null,
  };
  quality = {
    evaluatedSessions: 80,
    medianScore: 6.5 as number | null,
    responses: 40,
    avgRating: 4.1 as number | null,
  };
  coaching = { completedSessions: 90, sharePct: 22 as number | null };
  scribe = { sessions: 33, counsellors: 5 };
  latency = { turns: 1000, p95Ms: 1800 as number | null };
  llm = { costUsd: 12.5, calls: 250 };

  private hit<T>(name: string, arg: unknown, value: T): Promise<T> {
    this.calls.push({ name, arg });
    return this.fail ? Promise.reject(this.fail) : Promise.resolve(value);
  }
  overview(q: any) {
    return this.hit('overview', q, { summary: this.overviewSummary });
  }
  completionRate(q: any) {
    return this.hit('completionRate', q, { summary: this.completion });
  }
  qualityDistribution(q: any) {
    return this.hit('qualityDistribution', q, { summary: this.quality });
  }
  coachingLoop(q: any) {
    return this.hit('coachingLoop', q, { summary: this.coaching });
  }
  scribeAdoption(q: any) {
    return this.hit('scribeAdoption', q, { summary: this.scribe });
  }
  voiceLatency(q: any) {
    return this.hit('voiceLatency', q, { overall: this.latency });
  }
  llmUsage(window: any, task?: string) {
    this.calls.push({ name: 'llmUsage', arg: window, task });
    return this.fail ? Promise.reject(this.fail) : Promise.resolve(this.llm);
  }
}

/** In-memory PmImpactStorePort with the real UNIQUE (cardId, day) semantics. */
class FakeImpactStore implements PmImpactStorePort {
  rows: PmImpactRow[] = [];
  mirrored: { cardId: string; patch: Record<string, unknown> }[] = [];
  private seq = 0;

  async insertMissing(rows: PmImpactRowInsert[]): Promise<number[]> {
    const inserted: number[] = [];
    for (const row of rows) {
      if (this.rows.some((r) => r.cardId === row.cardId && r.day === row.day))
        continue;
      this.seq += 1;
      this.rows.push({
        ...row,
        id: `row-${this.seq}`,
        readAt: null,
        value: null,
        baseline: null,
        sampleSize: null,
        verdict: null,
        lastError: null,
      });
      inserted.push(row.day);
    }
    return inserted;
  }
  async rowsForCards(cardIds: string[]) {
    return this.rows
      .filter((r) => cardIds.includes(r.cardId))
      .map((r) => ({ ...r }));
  }
  async listDue(now: Date, limit: number) {
    return this.rows
      .filter(
        (r) => r.status === 'pending' && r.dueAt && new Date(r.dueAt) <= now,
      )
      .sort((a, b) => a.day - b.day)
      .slice(0, limit)
      .map((r) => ({ ...r }));
  }
  async updatePending(id: string, patch: PmImpactRowPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (!row || row.status !== 'pending') return false;
    Object.assign(row, patch);
    return true;
  }
  async mirrorOnDecision(cardId: string, patch: Record<string, unknown>) {
    this.mirrored.push({ cardId, patch });
  }
  async measuredCounts() {
    const measured = this.rows.filter(
      (r) => r.day === 14 && r.status === 'measured',
    );
    return {
      measured: measured.length,
      improved: measured.filter((r) => r.verdict === 'improved').length,
    };
  }
}

const DAY = 24 * 60 * 60 * 1000;

// ── catalog ─────────────────────────────────────────────────────────────────

describe('measurable-metric catalog', () => {
  const window = { from: '2026-11-01', to: '2026-11-14' };

  it('has unique keys and documents every entry for the lanes', () => {
    expect(new Set(PM_METRIC_KEYS).size).toBe(PM_METRIC_KEYS.length);
    const block = metricCatalogBlock();
    for (const entry of PM_METRIC_CATALOG) {
      expect(block).toContain(
        `- ${entry.key} | ${entry.label} | ${entry.unit}`,
      );
    }
  });

  it.each([
    ['roleplay_completion_rate', 40, 100, 'completionRate'],
    ['returning_user_rate', 38, 50, 'overview'],
    ['active_users', 50, 50, 'overview'],
    ['simulations_completed', 300, 300, 'overview'],
    ['roleplay_median_quality', 6.5, 80, 'qualityDistribution'],
    ['learner_avg_rating', 4.1, 40, 'qualityDistribution'],
    ['coaching_share_rate', 22, 90, 'coachingLoop'],
    ['scribe_sessions', 33, 33, 'scribeAdoption'],
    ['voice_latency_p95_ms', 1800, 1000, 'voiceLatency'],
    ['llm_cost_usd', 12.5, 250, 'llmUsage'],
  ])(
    '%s reads one number and its sample, platform-wide, for the window',
    async (source, value, sampleSize, called) => {
      const sources = new FakeSources();
      const result = await readMetric({ source }, window, sources);
      expect(result).toEqual({ status: 'ok', value, sampleSize });
      expect(sources.calls).toHaveLength(1);
      expect(sources.calls[0].name).toBe(called);
      // Exactly the window, never a tenant.
      expect(sources.calls[0].arg).toEqual(window);
    },
  );

  it('cost per call divides by calls and passes the task through', async () => {
    const sources = new FakeSources();
    const result = await readMetric(
      { source: 'llm_cost_per_call_usd', params: { task: 'pm_agent' } },
      window,
      sources,
    );
    expect(result).toEqual({ status: 'ok', value: 0.05, sampleSize: 250 });
    expect(sources.calls[0].task).toBe('pm_agent');
    sources.llm = { costUsd: 0, calls: 0 };
    expect(
      await readMetric(
        { source: 'llm_cost_per_call_usd', params: { task: 'pm_agent' } },
        window,
        sources,
      ),
    ).toEqual({ status: 'ok', value: null, sampleSize: 0 });
  });

  it('a suppressed (null) rate stays null, never zero', async () => {
    const sources = new FakeSources();
    sources.completion = { started: 4, completionRatePct: null };
    expect(
      await readMetric({ source: 'roleplay_completion_rate' }, window, sources),
    ).toEqual({ status: 'ok', value: null, sampleSize: 4 });
  });

  it('never throws: source errors, unknown sources and timeouts are unavailable', async () => {
    const sources = new FakeSources();
    sources.fail = new Error('db down');
    expect(
      await readMetric({ source: 'active_users' }, window, sources),
    ).toEqual({ status: 'unavailable', error: 'db down' });
    expect(
      await readMetric({ source: 'made_up' }, window, new FakeSources()),
    ).toMatchObject({ status: 'unavailable' });
    const slow = new FakeSources();
    slow.overview = () => new Promise(() => undefined) as never;
    expect(
      await readMetric({ source: 'active_users' }, window, slow, 10),
    ).toMatchObject({
      status: 'unavailable',
      error: expect.stringMatching(/timed out/),
    });
  });

  it('validates metricRef: source, params, unit, betterWhen', () => {
    expect(
      metricRefProblems({ source: 'active_users', betterWhen: 'up' }),
    ).toEqual([]);
    expect(
      metricRefProblems({
        source: 'llm_cost_per_call_usd',
        params: { task: 'pm_agent' },
        unit: 'usd',
        betterWhen: 'down',
      }),
    ).toEqual([]);
    expect(
      metricRefProblems({ source: 'nps', betterWhen: 'up' }).join(),
    ).toMatch(/not in the measurable-metric catalog/);
    expect(
      metricRefProblems({
        source: 'llm_cost_per_call_usd',
        betterWhen: 'down',
      }).join(),
    ).toMatch(/params\.task: required/);
    expect(
      metricRefProblems({
        source: 'llm_cost_usd',
        params: { task: 'not_a_task' },
        betterWhen: 'down',
      }).join(),
    ).toMatch(/params\.task: must be/);
    expect(
      metricRefProblems({
        source: 'active_users',
        params: { tenantId: 'x' },
        betterWhen: 'up',
      }).join(),
    ).toMatch(/takes no such parameter/);
    expect(
      metricRefProblems({
        source: 'active_users',
        unit: 'percent',
        betterWhen: 'up',
      }).join(),
    ).toMatch(/measured in count/);
    expect(
      metricRefProblems({
        source: 'active_users',
        betterWhen: 'sideways',
      }).join(),
    ).toMatch(/betterWhen/);
    expect(
      metricRefProblems({
        source: 'active_users',
        betterWhen: 'up',
        extra: 1,
      }).join(),
    ).toMatch(/metricRef\.extra: not allowed/);
  });
});

// ── payload contract + gate ─────────────────────────────────────────────────

describe('metricRef in the payload contract and gate layer 1', () => {
  const evidence = new Map<string, PmEvidenceRef>([
    [
      E1,
      {
        id: E1,
        source: 'analytics',
        kind: 'chart',
        label: 'Analytics',
        fetchedAt: new Date(),
        excerpt: '{}',
      },
    ],
  ]);
  const candidate = (metricRef?: unknown) => ({
    lane: PmLane.ANALYTICS,
    kind: PmCardKind.RECOMMENDATION,
    category: PmCardCategory.PRODUCT,
    payload: {
      schemaVersion: 1,
      ...recFor(0, [E1], metricRef === undefined ? {} : { metricRef }),
    },
  });

  it('is optional (old cards stay valid) and accepted when it names a catalog entry', () => {
    expect(
      validateCardPayload(PmCardKind.RECOMMENDATION, recommendationPayload()),
    ).toEqual([]);
    expect(
      deterministicGate(
        candidate({ source: 'roleplay_completion_rate', betterWhen: 'up' }),
        evidence,
        [],
      ),
    ).toEqual({ pass: true, reasons: [] });
  });

  it('gate layer 1 rejects an unknown metric source', () => {
    const verdict = deterministicGate(
      candidate({ source: 'invented_metric', betterWhen: 'up' }),
      evidence,
      [],
    );
    expect(verdict.pass).toBe(false);
    expect(verdict.reasons.join()).toMatch(
      /metricRef.*not in the measurable-metric catalog/,
    );
  });

  it('the lane check sends a bad metricRef back for repair', () => {
    const check = checkCandidate(
      {
        kind: 'recommendation',
        category: 'product',
        recommendation: recFor(0, [E1], {
          metricRef: { source: 'llm_cost_per_call_usd', betterWhen: 'down' },
        }),
      },
      PmLane.INFRA_COST,
      new Set([E1]),
    );
    expect(check.candidate).toBeUndefined();
    expect(check.errors.join()).toMatch(/params\.task: required/);
  });

  it('the compiled plan names the metric that will be measured', () => {
    const card = makeCard({
      payload: recommendationPayload({
        metricRef: { source: 'returning_user_rate', betterWhen: 'up' },
      }),
    });
    expect(compilePlan(card as never).markdown).toContain(
      'Measured after release: Returning users (`returning_user_rate`, percent, better up)',
    );
    expect(compilePlan(makeCard() as never).markdown).toContain(
      'Not automatically measured',
    );
  });
});

// ── schedule, verdict, formatting ───────────────────────────────────────────

describe('impact schedule and verdict', () => {
  it('baseline = 14 days before release; checks = 14 days ending on +14 / +30', () => {
    const released = new Date('2026-11-10T15:30:00Z');
    const [base, d14, d30] = impactSchedule(released);
    expect(base).toEqual({
      day: 0,
      window: { from: '2026-10-27', to: '2026-11-09' },
      dueAt: released,
    });
    expect(d14).toEqual({
      day: 14,
      window: { from: '2026-11-11', to: '2026-11-24' },
      dueAt: new Date('2026-11-25T00:00:00Z'),
    });
    expect(d30.window).toEqual({ from: '2026-11-27', to: '2026-12-10' });
    expect(d30.dueAt).toEqual(new Date('2026-12-11T00:00:00Z'));
  });

  const v = (
    baseline: number,
    value: number,
    betterWhen: 'up' | 'down' = 'up',
  ) =>
    impactVerdict({
      baseline,
      baselineSample: 100,
      value,
      sample: 100,
      minSample: 30,
      betterWhen,
    });

  it('judges by betterWhen with a 3% minimum relative change (boundary counts)', () => {
    expect(v(100, 103)).toMatchObject({
      status: 'measured',
      verdict: 'improved',
    });
    expect(v(100, 102.9)).toMatchObject({ verdict: 'flat' });
    expect(v(100, 97)).toMatchObject({ verdict: 'worse' });
    expect(v(100, 97.1)).toMatchObject({ verdict: 'flat' });
    expect(v(38, 44)).toMatchObject({ verdict: 'improved' });
    expect(v(1800, 1500, 'down')).toMatchObject({ verdict: 'improved' });
    expect(v(1800, 2000, 'down')).toMatchObject({ verdict: 'worse' });
    expect(v(0, 0)).toMatchObject({ verdict: 'flat' });
    expect(v(0, 2)).toMatchObject({ verdict: 'improved' });
  });

  it('is insufficient_data below the sample guard or without a value', () => {
    const base = {
      baseline: 10,
      value: 20,
      minSample: 30,
      betterWhen: 'up' as const,
    };
    expect(impactVerdict({ ...base, baselineSample: 29, sample: 100 })).toEqual(
      {
        status: 'insufficient_data',
      },
    );
    expect(impactVerdict({ ...base, baselineSample: 100, sample: 29 })).toEqual(
      {
        status: 'insufficient_data',
      },
    );
    expect(
      impactVerdict({ ...base, value: null, baselineSample: 100, sample: 100 }),
    ).toEqual({ status: 'insufficient_data' });
  });

  it('formats by unit and builds the plain-text summary', () => {
    expect(formatMetricValue(38, 'percent')).toBe('38%');
    expect(formatMetricValue(38.24, 'percent')).toBe('38.2%');
    expect(formatMetricValue(1204, 'count')).toBe('1,204');
    expect(formatMetricValue(950.4, 'ms')).toBe('950 ms');
    expect(formatMetricValue(0.01234, 'usd')).toBe('$0.0123');
    expect(formatMetricValue(12.5, 'usd')).toBe('$12.5');
    expect(formatMetricValue(4.123, 'ratio')).toBe('4.12');
    const checks = [
      { day: 14, status: 'measured', value: 41, verdict: 'improved' as const },
      { day: 30, status: 'measured', value: 44, verdict: 'improved' as const },
    ];
    expect(
      impactSummary({
        metricName: 'Next-day return',
        unit: 'percent',
        baseline: 38,
        checks,
      }),
    ).toBe('Next-day return: 38% to 44% (improved)');
    expect(
      impactSummary({
        metricName: 'Next-day return',
        unit: 'percent',
        baseline: 38,
        checks: [{ day: 14, status: 'insufficient_data', value: 40 }],
      }),
    ).toBe('Next-day return: 38% to 40% (not enough data)');
    expect(
      impactSummary({
        metricName: 'X',
        unit: 'percent',
        baseline: 38,
        checks: [],
      }),
    ).toBeUndefined();
    expect(
      impactSummary({
        metricName: 'X',
        unit: 'percent',
        baseline: null,
        checks,
      }),
    ).toBeUndefined();
  });
});

// ── the service ─────────────────────────────────────────────────────────────

describe('PmAgentImpactService', () => {
  let store: FakeImpactStore;
  let sources: FakeSources;
  let events: PmAgentEventsService;
  let pushed: string[];
  let service: PmAgentImpactService;
  const released = new Date('2026-11-10T15:30:00Z');

  beforeEach(() => {
    store = new FakeImpactStore();
    sources = new FakeSources();
    events = new PmAgentEventsService();
    pushed = [];
    events.setListener((event) => {
      if (event.type === 'card.updated') pushed.push(event.cardId);
    });
    service = new PmAgentImpactService(store, sources, events);
  });

  const measurableCard = (
    metricRef: Record<string, unknown> = {
      source: 'roleplay_completion_rate',
      betterWhen: 'up',
    },
  ) =>
    makeCard({
      payload: recommendationPayload({
        impactMetric: { name: 'Completion', direction: 'up' },
        metricRef,
      }),
    });

  it('captures the baseline at release and schedules +14 / +30, idempotently', async () => {
    const card = measurableCard();
    await service.onReleased(card, released, released);
    await service.onReleased(card, released, released); // reconcile twice
    expect(store.rows.map((r) => [r.day, r.status])).toEqual([
      [0, 'measured'],
      [14, 'pending'],
      [30, 'pending'],
    ]);
    expect(sources.calls).toHaveLength(1); // baseline read once
    expect(sources.calls[0].arg).toEqual({
      from: '2026-10-27',
      to: '2026-11-09',
    });
    expect(store.rows[0]).toMatchObject({ value: 40, sampleSize: 100 });
    expect(store.mirrored).toEqual([
      { cardId: card.id, patch: { baselineValue: 40 } },
    ]);
    expect(pushed).toEqual([card.id, card.id]);
  });

  it('writes nothing for a card without metricRef, and not_measurable for a bad one', async () => {
    await service.onReleased(makeCard(), released, released);
    expect(store.rows).toEqual([]);
    const bad = measurableCard({ source: 'retired_metric', betterWhen: 'up' });
    await service.onReleased(bad, released, released);
    expect(store.rows.map((r) => r.status)).toEqual([
      'not_measurable',
      'not_measurable',
      'not_measurable',
    ]);
    expect(sources.calls).toHaveLength(0);
  });

  it('reads a due check against the baseline and records the verdict', async () => {
    const card = measurableCard();
    await service.onReleased(card, released, released);
    sources.completion = { started: 120, completionRatePct: 46 };
    // Not due yet: nothing happens.
    expect(await service.runDue(new Date('2026-11-24T23:00:00Z'))).toBe(0);
    expect(await service.runDue(new Date('2026-11-25T00:00:01Z'))).toBe(1);
    const d14 = store.rows.find((r) => r.day === 14)!;
    expect(d14).toMatchObject({
      status: 'measured',
      verdict: 'improved',
      value: 46,
      baseline: 40,
      sampleSize: 120,
    });
    expect(sources.calls[1].arg).toEqual({
      from: '2026-11-11',
      to: '2026-11-24',
    });
    expect(store.rows.find((r) => r.day === 30)!.status).toBe('pending');
    expect(await service.healthFigures()).toEqual({
      impactMeasuredCount: 1,
      impactImprovedRate: 1,
    });
  });

  it('marks a thin window insufficient_data, with the value but no verdict', async () => {
    const card = measurableCard();
    await service.onReleased(card, released, released);
    sources.completion = { started: 12, completionRatePct: 80 };
    await service.runDue(new Date('2026-11-26T00:00:00Z'));
    expect(store.rows.find((r) => r.day === 14)).toMatchObject({
      status: 'insufficient_data',
      verdict: null,
      value: 80,
    });
  });

  it('retries a failed read on later ticks and gives up after 3 attempts', async () => {
    const card = measurableCard();
    await service.onReleased(card, released, released);
    sources.fail = new Error('timeout');
    const due = new Date('2026-11-25T01:00:00Z');
    await service.runDue(due);
    let d14 = store.rows.find((r) => r.day === 14)!;
    expect(d14).toMatchObject({
      status: 'pending',
      attempts: 1,
      lastError: 'timeout',
    });
    await service.runDue(new Date(due.getTime() + DAY));
    d14 = store.rows.find((r) => r.day === 14)!;
    expect(d14).toMatchObject({ status: 'pending', attempts: 2 });
    await service.runDue(new Date(due.getTime() + 2 * DAY));
    d14 = store.rows.find((r) => r.day === 14)!;
    expect(d14).toMatchObject({ status: 'unavailable', attempts: 3 });
    // Terminal: never read again.
    const before = sources.calls.length;
    await service.runDue(new Date(due.getTime() + 3 * DAY));
    expect(sources.calls.length).toBe(before);
  });

  it('a check waits for a pending baseline, and follows a failed one', async () => {
    const card = measurableCard();
    sources.fail = new Error('boom');
    await service.onReleased(card, released, released);
    expect(store.rows[0]).toMatchObject({ status: 'pending', attempts: 1 });
    // Baseline retried (fails), check due but waits on it.
    await service.runDue(new Date('2026-11-25T01:00:00Z'));
    expect(store.rows[0]).toMatchObject({ status: 'pending', attempts: 2 });
    expect(store.rows[1]).toMatchObject({ status: 'pending', attempts: 0 });
    // Third failure: baseline terminal, check becomes unavailable without a read.
    const calls = sources.calls.length;
    await service.runDue(new Date('2026-11-26T01:00:00Z'));
    expect(store.rows[0].status).toBe('unavailable');
    expect(store.rows[1]).toMatchObject({
      status: 'unavailable',
      lastError: 'the pre-release baseline could not be read',
    });
    expect(sources.calls.length).toBe(calls + 1);
  });

  it('presents delivery.impact per the contract', async () => {
    const card = measurableCard({
      source: 'returning_user_rate',
      betterWhen: 'up',
    });
    card.payload.impactMetric = { name: 'Next-day return', direction: 'up' };
    await service.onReleased(card, released, released);
    sources.overviewSummary = {
      activeUsers: 60,
      simulationsCompleted: 1,
      retentionRatePct: 44,
    };
    await service.runDue(new Date('2026-11-25T08:00:00Z'));
    const views = await service.views([card, makeCard()]);
    expect(views.size).toBe(1);
    expect(views.get(card.id)).toEqual({
      metricName: 'Next-day return',
      direction: 'up',
      unit: 'percent',
      baseline: 38,
      checks: [
        {
          day: 14,
          status: 'measured',
          value: 44,
          readAt: '2026-11-25T08:00:00.000Z',
          dueAt: '2026-11-25T00:00:00.000Z',
          verdict: 'improved',
        },
        { day: 30, status: 'pending', dueAt: '2026-12-11T00:00:00.000Z' },
      ],
      summary: 'Next-day return: 38% to 44% (improved)',
    });
  });

  it('presents a not-yet-released measurable card with no checks', async () => {
    const card = measurableCard();
    expect((await service.views([card])).get(card.id)).toEqual({
      metricName: 'Completion',
      direction: 'up',
      unit: 'percent',
      checks: [],
    });
  });

  it('never throws into reconcile', async () => {
    const broken = new FakeImpactStore();
    broken.insertMissing = () => Promise.reject(new Error('db'));
    const svc = new PmAgentImpactService(broken, sources, events);
    await expect(
      svc.onReleased(measurableCard(), released, released),
    ).resolves.toBeUndefined();
    broken.listDue = () => Promise.reject(new Error('db'));
    await expect(svc.runDue(new Date())).resolves.toBe(0);
  });

  it('uses the configured retry limit', () => {
    expect(PM_IMPACT.MAX_ATTEMPTS).toBe(3);
  });
});

// ── learning ────────────────────────────────────────────────────────────────

describe('impact verdicts in learning', () => {
  const now = new Date('2026-11-17T00:00:00Z');
  const row = (over: Partial<PmOutcomeRow>): PmOutcomeRow => ({
    cardId: 'c',
    category: PmCardCategory.PRODUCT,
    lane: PmLane.ANALYTICS,
    kind: PmCardKind.RECOMMENDATION,
    decision: PmDecision.ACCEPTED,
    decidedAt: now,
    merged: true,
    released: true,
    buildFailed: false,
    reverted: false,
    title: 'Show streaks on start',
    payload: { whyHeadline: '41% do not return' },
    reason: null,
    reasonChip: null,
    ...over,
  });
  const score = (over: Partial<PmOutcomeRow>) => {
    const stat = computeLearnedStats([row(over)], now).get(
      statKey('category', PmCardCategory.PRODUCT),
    )!;
    return { positive: stat.positive, negative: stat.negative };
  };

  it('improved adds +1, worse adds −1, flat and none add 0', () => {
    expect(score({})).toEqual({ positive: 1.5, negative: 0 });
    expect(score({ impactVerdict: 'improved' })).toEqual({
      positive: 2.5,
      negative: 0,
    });
    expect(score({ impactVerdict: 'worse' })).toEqual({
      positive: 1.5,
      negative: 1,
    });
    expect(score({ impactVerdict: 'flat' })).toEqual({
      positive: 1.5,
      negative: 0,
    });
    // Lane scores move the same way.
    const lane = computeLearnedStats(
      [row({ impactVerdict: 'improved' })],
      now,
    ).get(statKey('lane', PmLane.ANALYTICS))!;
    expect(lane.positive).toBe(2.5);
  });

  it('effective-positive exemplars need merged AND not worse', () => {
    const picked = pickExemplars(
      [
        row({ cardId: 'good', impactVerdict: 'improved' }),
        row({ cardId: 'bad', impactVerdict: 'worse' }),
      ],
      'streaks',
    );
    expect(picked.positives.map((r) => r.cardId)).toEqual(['good']);
    expect(picked.negatives.map((r) => r.cardId)).toEqual(['bad']);
  });
});
