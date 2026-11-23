import { scheduledTaskRegistry } from '../../../scheduler/registry/scheduled-task.registry';
import { AssistantsMonitoringService } from '../assistants-monitoring.service';

const NOW = new Date('2026-11-23T10:00:00Z');

function build(
  answers: Array<[string, unknown[]]>,
  env: Record<string, string> = {},
) {
  const query = jest.fn(async (sql: string) => {
    for (const [needle, rows] of answers) if (sql.includes(needle)) return rows;
    return [];
  });
  const sendBlocks = jest.fn(async () => ({ ok: true }));
  const service = new AssistantsMonitoringService(
    { query } as never,
    { get: (k: string) => env[k] } as never,
    { sendBlocks } as never,
  );
  return { service, query, sendBlocks };
}

describe('AssistantsMonitoringService', () => {
  it('registers on the 5-minute interval', () => {
    const { service } = build([]);
    service.onModuleInit();
    expect(
      scheduledTaskRegistry
        .getHandlers('5min')
        .some((t) => t.taskName === 'assistants-monitoring'),
    ).toBe(true);
  });

  it('ledger: breaches on a drifting or negative account, quiet otherwise', async () => {
    const bad = build([
      [
        'FROM billing_accounts',
        [
          {
            id: 'a1',
            owner_user_id: 7,
            free: -5,
            grant_drift: 0,
            set_aside_drift: 0,
          },
        ],
      ],
    ]);
    const r = await bad.service.checkLedger();
    expect(r.breached).toBe(true);
    expect(r.detail).toContain('free=-5');
    const ok = build([['FROM billing_accounts', []]]);
    expect((await ok.service.checkLedger()).breached).toBe(false);
  });

  it('outbox: counts failed and stuck rows', async () => {
    const { service } = build([
      ['FROM alert_outbox', [{ failed: '2', stuck: '1' }]],
    ]);
    const r = await service.checkOutbox(NOW);
    expect(r).toMatchObject({ check: 'outbox', breached: true });
    expect(r.detail).toContain('failed=2 stuck=1');
  });

  it('untaken: only flags with no raised alert', async () => {
    const { service } = build([['safety_first_at', [{ n: '3' }]]]);
    expect((await service.checkUntaken(NOW)).breached).toBe(true);
    const none = build([['safety_first_at', [{ n: '0' }]]]);
    expect((await none.service.checkUntaken(NOW)).breached).toBe(false);
  });

  it('cost records and unpriced events', async () => {
    const { service } = build([
      [
        '"payerAccountId" IS NULL) AS no_payer',
        [{ no_cost: '1', no_payer: '0' }],
      ],
      ['"costMicros" IS NULL AND', [{ provider: 'x', model: 'm', n: '4' }]],
    ]);
    expect((await service.checkCostRecords(NOW)).breached).toBe(true);
    const u = await service.checkUnpriced(NOW);
    expect(u.breached).toBe(true);
    expect(u.detail).toContain('x/m:4');
  });

  it('feed: reported off, or stalled with nothing recorded', async () => {
    const off = build([
      [
        'usage_feed_off',
        [{ reported_off: true, stalled: '0', recorded: true }],
      ],
    ]);
    expect((await off.service.checkFeed(NOW)).breached).toBe(true);
    const stalled = build([
      [
        'usage_feed_off',
        [{ reported_off: false, stalled: '6', recorded: false }],
      ],
    ]);
    expect((await stalled.service.checkFeed(NOW)).breached).toBe(true);
    const fine = build([
      [
        'usage_feed_off',
        [{ reported_off: false, stalled: '6', recorded: true }],
      ],
    ]);
    expect((await fine.service.checkFeed(NOW)).breached).toBe(false);
  });

  it('retention: out-of-range count breaches, no sweep yet does not', async () => {
    const big = build([
      [
        'global_settings',
        [{ value: { lastCounts: { messages: 500000, memory: 3 } } }],
      ],
    ]);
    const r = await big.service.checkRetention();
    expect(r.breached).toBe(true);
    expect(r.detail).toContain('messages=500000');
    const none = build([['global_settings', []]]);
    expect((await none.service.checkRetention()).breached).toBe(false);
  });

  it('a per-check switch turns that check off; the master switch turns all off', async () => {
    const { service, query } = build([], {
      ASSISTANT_MONITOR_LEDGER_ENABLED: 'false',
    });
    const results = await service.runChecks(NOW);
    expect(results.map((r) => r.check)).not.toContain('ledger');
    expect(results).toHaveLength(6);
    const off = build([], { ASSISTANT_MONITOR_ENABLED: 'off' });
    expect(await off.service.runScheduled(NOW)).toEqual([]);
    expect(off.query).not.toHaveBeenCalled();
    expect(query).toHaveBeenCalled();
  });

  it('posts a breach to Slack once per cooldown and a failing check becomes a breach', async () => {
    const { service, sendBlocks } = build([
      ['FROM alert_outbox', [{ failed: '1', stuck: '0' }]],
    ]);
    await service.runScheduled(NOW);
    await service.runScheduled(new Date(NOW.getTime() + 5 * 60_000));
    const outbox = sendBlocks.mock.calls.filter((c) =>
      JSON.stringify(c).includes('outbox'),
    );
    expect(outbox).toHaveLength(1);

    const broken = new AssistantsMonitoringService(
      { query: jest.fn().mockRejectedValue(new Error('db down')) } as never,
      { get: () => undefined } as never,
    );
    const results = await broken.runChecks(NOW);
    expect(results.every((r) => r.breached)).toBe(true);
    expect(results[0].detail).toContain('db down');
  });
});
