import { GuideAlertService } from '../guide-alert.service';

function setup(data: {
  turns?: { total: number; failed: number };
  ttft?: { turns: number; p95: number };
  cost?: { today: number; median: number | null };
  crisis?: { today: number; dailyAverage: number };
  anon?: { usd: number };
  cache?: { turns: number; input: number; cacheRead: number };
}) {
  const inserted: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('INSERT INTO "guide_alerts"')) {
        inserted.push(params);
        return [{ id: `a${inserted.length}` }];
      }
      if (sql.includes("interval '30 minutes'"))
        return [data.turns ?? { total: 0, failed: 0 }];
      if (sql.includes('percentile_cont(0.95)'))
        return [data.ttft ?? { turns: 0, p95: 0 }];
      if (sql.includes('WITH daily'))
        return [data.cost ?? { today: 0, median: null }];
      if (sql.includes('"guide_signals"'))
        return [data.crisis ?? { today: 0, dailyAverage: 0 }];
      if (sql.includes('"visitorId" IS NOT NULL'))
        return [data.anon ?? { usd: 0 }];
      if (sql.includes('agent_turn_traces'))
        return [data.cache ?? { turns: 0, input: 0, cacheRead: 0 }];
      return [];
    }),
  };
  const alerts = {
    findOne: jest.fn(async ({ where }: any) => ({ id: where.id })),
    update: jest.fn(async () => undefined),
  };
  const service = new GuideAlertService(
    alerts as never,
    dataSource as never,
    { allyGuideAlertWebhookUrl: null } as never,
  );
  return { service, inserted, alerts };
}

describe('GuideAlertService', () => {
  it('stays quiet on a healthy or quiet hour', async () => {
    expect(await setup({}).service.evaluate()).toEqual([]);
    // Too few turns to judge, however bad they look.
    expect(
      await setup({ turns: { total: 5, failed: 5 } }).service.evaluate(),
    ).toEqual([]);
  });

  it('fires each rule past its threshold, with the right severity', async () => {
    const firings = await setup({
      turns: { total: 40, failed: 10 },
      ttft: { turns: 30, p95: 7200 },
      cost: { today: 30, median: 10 },
      crisis: { today: 4, dailyAverage: 0.5 },
      anon: { usd: 25 },
      cache: { turns: 30, input: 9000, cacheRead: 1000 },
    }).service.evaluate();
    const by = Object.fromEntries(firings.map((f) => [f.rule, f.severity]));
    expect(by).toEqual({
      turn_failures: 'critical',
      ttft_slo: 'warning',
      cost_anomaly: 'warning',
      crisis_spike: 'critical',
      anonymous_cap: 'critical',
      cache_health: 'warning',
    });
    // Numbers only: nothing in an alert names a learner or a message.
    expect(JSON.stringify(firings)).not.toMatch(/userId|tenant|message/);
  });

  it('a small cost day is not an anomaly, however it compares', async () => {
    const firings = await setup({
      cost: { today: 3, median: 0.5 },
    }).service.evaluate();
    expect(firings).toEqual([]);
  });

  it('stores one alert per rule per window', async () => {
    const t = setup({ turns: { total: 40, failed: 4 } });
    await t.service.check();
    expect(t.inserted).toHaveLength(1);
    expect(String(t.inserted[0][2])).toMatch(
      /^turn_failures:\d{4}-\d{2}-\d{2}T\d{2}$/,
    );
  });
});
