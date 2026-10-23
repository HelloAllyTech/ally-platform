import axios from 'axios';

import { AppConfigService } from 'src/config/config.service';
import { RedisService } from 'src/redis/service/redis.service';

import { CodeActivityService } from '../code-activity.service';

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

type Vars = {
  name: string;
  since: string;
  until: string;
  after: string | null;
  path: string | null;
};

const commit = (
  oid: string,
  committedDate: string,
  additions: number,
  deletions: number,
  parents = 1,
) => ({
  oid,
  committedDate,
  additions,
  deletions,
  parents: { totalCount: parents },
});

const page = (nodes: ReturnType<typeof commit>[]) => ({
  data: {
    data: {
      repository: {
        defaultBranchRef: {
          target: {
            history: {
              pageInfo: { hasNextPage: false, endCursor: null },
              nodes,
            },
          },
        },
      },
    },
  },
});

/**
 * The heatmap across the 2026-10-23 monorepo cutover. Each source is read on
 * its side of the line — the moved repos before, the monorepo after — and
 * every monorepo commit is counted once, under the repo whose folder it
 * touched.
 */
describe('CodeActivityService across the monorepo cutover', () => {
  const calls: Vars[] = [];
  const service = new CodeActivityService(
    {
      githubToken: 'gh-token',
      githubOrg: 'HelloAllyTech',
      githubMonorepo: 'ally-platform',
    } as unknown as AppConfigService,
    {
      get: jest.fn().mockResolvedValue(null),
      set: jest.fn(),
    } as unknown as RedisService,
  );

  /** Routes GraphQL calls by `repo` or `repo:path`; anything unlisted is empty. */
  const respond = (routes: Record<string, ReturnType<typeof commit>[]>) =>
    mockedAxios.post.mockImplementation(async (_url, body) => {
      const vars = (body as { variables: Vars }).variables;
      calls.push(vars);
      const key = vars.path ? `${vars.name}:${vars.path}` : vars.name;
      return page(routes[key] ?? []) as never;
    });

  beforeEach(() => {
    jest.clearAllMocks();
    calls.length = 0;
  });

  it('reads a moved repo only up to the cutover, and not at all after it', async () => {
    respond({});

    await service.dailyByRepo(['2026-10', '2026-11'], Date.parse('2026-11-05'));

    const allyBe = calls.filter((v) => v.name === 'ally-be' && !v.path);
    expect(allyBe).toHaveLength(1);
    expect(allyBe[0]).toMatchObject({
      since: '2026-10-01T00:00:00Z',
      until: '2026-10-23T05:21:16Z',
    });
    // infra did not move: read whole months on both sides.
    expect(calls.filter((v) => v.name === 'infra')).toHaveLength(2);
  });

  it('counts each monorepo commit once, under the repo whose folder it touched', async () => {
    respond({
      'ally-platform': [
        commit('c1', '2026-10-24T10:00:00Z', 10, 2), // ally-be only
        commit('c2', '2026-10-24T11:00:00Z', 100, 0), // ally-be and ally-web
        commit('c3', '2026-10-24T12:00:00Z', 5, 5), // root files only
        commit('c4', '2026-10-24T13:00:00Z', 7, 1), // the wiki source
        commit('m1', '2026-10-24T14:00:00Z', 999, 999, 2), // a merge
      ],
      'ally-platform:ally-be/': [
        commit('c1', '', 0, 0),
        commit('c2', '', 0, 0),
        commit('m1', '', 0, 0, 2),
      ],
      'ally-platform:ally-web/': [commit('c2', '', 0, 0)],
      'ally-platform:helloallytech.github.io/': [commit('c4', '', 0, 0)],
    });

    const { byRepo, incomplete } = await service.dailyByRepo(
      ['2026-10'],
      Date.parse('2026-10-25'),
    );

    expect(incomplete).toBe(false);
    expect(byRepo['ally-be']?.['2026-10-24']).toEqual([10, 2]);
    expect(byRepo['ally-web']?.['2026-10-24']).toBeUndefined();
    expect(byRepo['helloallytech.github.io']?.['2026-10-24']).toEqual([7, 1]);
    expect(byRepo['ally-platform']?.['2026-10-24']).toEqual([105, 5]);
    // The monorepo is read from the cutover on: before it is imported history.
    expect(
      calls.find((v) => v.name === 'ally-platform' && !v.path)?.since,
    ).toBe('2026-10-23T05:21:17Z');
  });

  it('adds both sides into one heatmap total', async () => {
    respond({
      'ally-be': [commit('old', '2026-10-22T09:00:00Z', 40, 10)],
      'ally-platform': [commit('new', '2026-10-24T09:00:00Z', 3, 1)],
      'ally-platform:ally-be/': [commit('new', '', 0, 0)],
    });

    // The window is clamped to today; read it from after both days.
    jest
      .useFakeTimers({
        doNotFake: ['setImmediate', 'nextTick', 'queueMicrotask'],
      })
      .setSystemTime(new Date('2026-10-25T12:00:00Z'));
    const result = await service
      .getActivity({ until: '2026-10-24', days: 3 })
      .finally(() => jest.useRealTimers());

    const byDate = Object.fromEntries(
      result.days.map((day) => [day.date, day.churn]),
    );
    expect(byDate).toEqual({
      '2026-10-22': 50,
      '2026-10-23': 0,
      '2026-10-24': 4,
    });
  });
});
