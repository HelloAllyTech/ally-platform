import { DataSource, EntityManager } from 'typeorm';

import { RoadmapMultiplierService } from '../roadmap-multiplier.service';
import { AppConfigService } from 'src/config/config.service';

const USER = 7;

/**
 * The service issues two kinds of query — the qualifying-authors one (mentions
 * `lastIncreasedAt`) and the candidate-authors count — so the fake routes on that.
 */
const makeManager = (opts: {
  authors: { author: number; last: Date }[];
  candidates: number;
}) =>
  ({
    query: jest.fn(async (sql: string) =>
      sql.includes('lastIncreasedAt')
        ? opts.authors
        : [{ n: String(opts.candidates) }],
    ),
    findOne: jest.fn(async () => ({ id: 9, name: 'Priya' })),
  }) as unknown as EntityManager;

const build = (enabled: boolean, manager: EntityManager) =>
  new RoadmapMultiplierService(
    { manager } as unknown as DataSource,
    { roadmapMultiplierEnabled: enabled } as unknown as AppConfigService,
  );

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);

describe('RoadmapMultiplierService', () => {
  it('is 1.0 for new votes while the flag is off', async () => {
    const manager = makeManager({
      authors: [{ author: 1, last: daysAgo(1) }],
      candidates: 8,
    });
    await expect(
      build(false, manager).multiplierFor(manager, USER),
    ).resolves.toBe(1);
  });

  it('scales with distinct colleagues backed', async () => {
    const manager = makeManager({
      authors: [1, 2, 3, 4].map((a) => ({ author: a, last: daysAgo(2) })),
      candidates: 10,
    });
    // 4 of min(8,10)=8 -> 1 + 0.3 * 0.5
    await expect(
      build(true, manager).multiplierFor(manager, USER),
    ).resolves.toBe(1.15);
  });

  it('caps the target at the colleagues that actually exist', async () => {
    const manager = makeManager({
      authors: [1, 2].map((a) => ({ author: a, last: daysAgo(2) })),
      candidates: 2,
    });
    await expect(
      build(true, manager).multiplierFor(manager, USER),
    ).resolves.toBe(1.3);
  });

  it('reports the next drop, with the colleague whose vote ages out', async () => {
    const manager = makeManager({
      authors: [
        { author: 9, last: daysAgo(13) },
        { author: 2, last: daysAgo(1) },
      ],
      candidates: 8,
    });
    const breadth = await build(true, manager).getBreadth(USER);

    expect(breadth).toMatchObject({
      enabled: true,
      qualifying: 2,
      target: 8,
      windowDays: 14,
      maxMultiplier: 1.3,
      nextDropMultiplier: 1.04,
      nextDropAuthorName: 'Priya',
    });
    // ~1 day from now: 13 days ago + 14 day window.
    const hoursAway =
      (new Date(breadth.nextDropAt as string).getTime() - Date.now()) /
      3_600_000;
    expect(hoursAway).toBeGreaterThan(20);
    expect(hoursAway).toBeLessThan(28);
  });

  it('reports disabled with no drop when the flag is off', async () => {
    const manager = makeManager({
      authors: [{ author: 1, last: daysAgo(1) }],
      candidates: 8,
    });
    const breadth = await build(false, manager).getBreadth(USER);
    expect(breadth).toMatchObject({
      enabled: false,
      multiplier: 1,
      nextDropAt: null,
    });
  });
});
