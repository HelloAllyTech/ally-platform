import { DataSource } from 'typeorm';
import { PlanViewService } from '../service/plan-view.service';

/**
 * The owner's Monthly usage warning, from the spend state alone (no Postgres): the
 * percentage is worked out from integer micros, so exactly 80% reads 80 and warns.
 */
describe('PlanViewService monthly usage warning', () => {
  const viewFor = (usedMicros: number, capMicros: number | null) => {
    const dataSource = {
      query: jest.fn(async () => []),
    } as unknown as DataSource;
    const plans = {
      isCreator: jest.fn(async () => true),
      planOf: jest.fn(async () => ({
        plan: {
          key: 'pro',
          name: 'Pro',
          maxPublished: null,
          ownerRuns: 100,
          customerConversations: 100,
        },
        subscription: null,
        anchor: '2026-11-01',
      })),
      publishedCount: jest.fn(async () => 0),
      seatsOf: jest.fn(),
      peopleInOrder: jest.fn(),
    } as any;
    const spend = {
      state: jest.fn(async () => ({
        usedMicros,
        capMicros,
        period: { start: '2026-11-01', end: '2026-12-01' },
      })),
    } as any;
    return new PlanViewService(dataSource, plans, spend, {} as any).forUser(1);
  };

  it.each([
    [8_040_000, 10_050_000], // 8.04 / 10.05 * 100 is 79.999... in floating point
    [4_520_000, 5_650_000],
    [16_080_000, 20_100_000],
    [8_000_000, 10_000_000],
  ])('warns at exactly 80%% (%i of %i micros)', async (used, cap) => {
    expect((await viewFor(used, cap)).alerts).toEqual([
      { what: 'Monthly usage', percent: 80 },
    ]);
  });

  it('does not warn just under 80%', async () => {
    expect((await viewFor(7_999_999, 10_000_000)).alerts).toEqual([]);
  });

  it('says 100% once the cap is reached', async () => {
    expect((await viewFor(10_600_000, 10_000_000)).alerts).toEqual([
      { what: 'Monthly usage', percent: 100 },
    ]);
  });

  it('has no warning without a cap', async () => {
    expect((await viewFor(5_000_000, null)).alerts).toEqual([]);
  });
});
