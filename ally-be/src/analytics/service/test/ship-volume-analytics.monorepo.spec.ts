import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';
import { CodeActivityService } from 'src/changelog/service/code-activity.service';

import { ShipVolumeAnalyticsService } from '../ship-volume-analytics.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      warn: jest.fn(),
      error: jest.fn(),
      info: jest.fn(),
    })),
  },
}));

const week = (sunday: string) => Date.parse(`${sunday}T00:00:00Z`) / 1000;

/**
 * The admin ship-volume chart across the 2026-10-23 monorepo cutover (its
 * week starts Sunday 2026-10-18). Weeks before that week are GitHub's weekly
 * statistics; from it on they are rebuilt from per-commit daily totals, which
 * are the only numbers that neither count the imported history twice nor
 * lose which service did the work.
 */
describe('ShipVolumeAnalyticsService across the monorepo cutover', () => {
  const dailyByRepo = jest.fn();
  const service = new ShipVolumeAnalyticsService(
    {
      githubToken: 'token',
      githubOrg: 'HelloAllyTech',
      githubMonorepo: 'ally-platform',
    } as unknown as AppConfigService,
    {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    } as unknown as RedisService,
    { dailyByRepo } as unknown as CodeActivityService,
  );

  beforeEach(() => {
    jest.clearAllMocks();
    jest
      .useFakeTimers({
        doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
      })
      .setSystemTime(new Date('2026-11-04T12:00:00Z'));
    mockedAxios.get.mockImplementation(
      async (url: string) =>
        ({
          data: url.includes('/ally-be/')
            ? [
                [week('2026-10-11'), 100, -10],
                [week('2026-10-18'), 50, -5],
                // Never trusted from the cutover's week on, whatever it says.
                [week('2026-10-25'), 999, -999],
              ]
            : [],
        }) as never,
    );
  });

  afterEach(() => jest.useRealTimers());

  it("keeps GitHub's weeks before the cutover and rebuilds the rest from commits", async () => {
    dailyByRepo.mockResolvedValue({
      byRepo: {
        'ally-be': { '2026-10-20': [50, 5], '2026-10-26': [7, 1] },
        'ally-platform': { '2026-10-27': [3, 3] },
      },
      incomplete: false,
    });

    const result = await service.getShipVolume({ weeks: 4 });

    const churn = (weekStart: string, repo: string) =>
      result.weeks
        .find((w) => w.weekStart === weekStart)
        ?.repos.find((r) => r.repo === repo)?.churn ?? 0;
    expect(churn('2026-10-11', 'ally-be')).toBe(110);
    expect(churn('2026-10-18', 'ally-be')).toBe(55);
    expect(churn('2026-10-25', 'ally-be')).toBe(8);
    expect(churn('2026-10-25', 'ally-platform')).toBe(6);
    expect(result.repos).toContain('ally-platform');
    expect(dailyByRepo).toHaveBeenCalledWith(
      ['2026-10', '2026-11'],
      expect.any(Number),
    );
  });

  it('says so when commits since the cutover could not all be read', async () => {
    dailyByRepo.mockResolvedValue({ byRepo: {}, incomplete: true });

    const result = await service.getShipVolume({ weeks: 4 });

    expect(result.unavailableRepos).toContainEqual({
      repo: 'ally-platform',
      reason: 'unreachable',
      servedFromCache: false,
    });
  });
});
