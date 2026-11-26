import { ManualBudgetService } from '../service/manual-budget.service';

function build(opts: {
  monthly?: number;
  usage?: Record<string, unknown>[];
  reserved?: string;
}) {
  const query = jest.fn(async (sql: string, ...rest: unknown[]) => {
    void rest;
    if (sql.includes('FROM llm_usage')) return opts.usage ?? [];
    if (sql.includes('FROM manual_runs'))
      return [{ reserved: opts.reserved ?? '0' }];
    return [];
  });
  const settings = {
    get: jest.fn(async () => ({ monthlyBudgetUsd: opts.monthly ?? 100 })),
  };
  return {
    service: new ManualBudgetService({ query } as never, settings as never),
    query,
  };
}

const usage = (extra: Record<string, unknown>) => ({
  service: 'llm',
  provider: 'openai',
  model: 'gpt-4o',
  task: 'product_manual_chat',
  prompt: '0',
  completion: '0',
  total: '0',
  cached: '0',
  audio: '0',
  chars: '0',
  ...extra,
});

describe('ManualBudgetService.runCapUsd', () => {
  const { service } = build({});
  const cap = (
    monthlyBudgetUsd: number,
    spentUsd: number,
    reservedUsd: number,
  ) => service.runCapUsd({ monthlyBudgetUsd, spentUsd, reservedUsd });

  it('is a quarter of the month when plenty is left', () => {
    expect(cap(100, 0, 0)).toBe(25);
    expect(cap(100, 40, 0)).toBe(25);
  });
  it('is what is left when less than a quarter remains', () => {
    expect(cap(100, 70, 20)).toBe(10);
    expect(cap(100, 90, 0)).toBe(10);
  });
  it('subtracts open reservations as well as spend', () => {
    expect(cap(100, 50, 40)).toBe(10);
  });
  it('floors at zero when the month is used up or over', () => {
    expect(cap(100, 100, 0)).toBe(0);
    expect(cap(100, 120, 5)).toBe(0);
  });
});

describe('ManualBudgetService.snapshot', () => {
  it('prices llm_usage rows for both manual tasks this IST month and adds open reservations', async () => {
    const { service, query } = build({
      monthly: 100,
      // 1M prompt + 1M completion tokens of gpt-4o = 2.5 + 10 USD each.
      usage: [
        usage({ prompt: '1000000', completion: '1000000' }),
        usage({
          task: 'product_manual_agent',
          prompt: '1000000',
          completion: '1000000',
        }),
      ],
      reserved: '3.5',
    });
    const now = new Date('2026-11-26T10:00:00Z');
    const snap = await service.snapshot(now);
    expect(snap).toEqual({
      monthlyBudgetUsd: 100,
      spentUsd: 25,
      reservedUsd: 3.5,
      exhausted: false,
      approximate: false,
    });
    const usageCall = query.mock.calls.find((c) =>
      String(c[0]).includes('FROM llm_usage'),
    )!;
    expect(usageCall[1]).toEqual([
      new Date('2026-10-31T18:30:00.000Z'),
      'product\\_manual\\_%',
    ]);
  });

  it('is exhausted once spend plus reservations reach the budget', async () => {
    const { service } = build({
      monthly: 10,
      usage: [usage({ prompt: '1000000', completion: '1000000' })], // 12.5 USD
    });
    expect((await service.snapshot()).exhausted).toBe(true);
    const spare = build({
      monthly: 20,
      usage: [usage({ prompt: '1000000', completion: '1000000' })],
      reserved: '7.5',
    });
    expect((await spare.service.snapshot()).exhausted).toBe(true);
    const ok = build({
      monthly: 20,
      usage: [usage({ prompt: '1000000', completion: '1000000' })],
      reserved: '7',
    });
    expect((await ok.service.snapshot()).exhausted).toBe(false);
  });

  it('counts an unpriced model as zero and flags the figure approximate', async () => {
    const { service } = build({
      usage: [usage({ model: 'some-model-nobody-priced', prompt: '5000000' })],
    });
    expect(await service.snapshot()).toMatchObject({
      spentUsd: 0,
      approximate: true,
    });
  });

  it('reads zero spend and zero reservations from an empty database', async () => {
    const { service } = build({});
    expect(await service.snapshot()).toMatchObject({
      spentUsd: 0,
      reservedUsd: 0,
      exhausted: false,
    });
  });
});
