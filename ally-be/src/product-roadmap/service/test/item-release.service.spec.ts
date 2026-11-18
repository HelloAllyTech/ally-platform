import { BadRequestException, NotFoundException } from '@nestjs/common';

import {
  ItemLinkSource,
  ItemLinkState,
  ItemReleaseState,
} from '../../enum/item-release.enum';
import { RoadmapOpportunityStage } from '../../enum/roadmap-opportunity.enum';
import { ItemReleaseService } from '../item-release.service';

/**
 * Release tracking against mocked GitHub and repositories. The rules
 * themselves are covered in item-release.util.spec; this covers the wiring:
 * what is compared against what, what is written, and what is left alone.
 */

const MONO = 'HelloAllyTech/ally-platform';
const MERGE_SHA = 'merge-sha-1';
const merged = new Date('2026-11-10T10:00:00Z');

/** A tiny in-memory table with the repository calls the service makes. */
function table<T extends Record<string, any>>(rows: T[] = []) {
  const matches = (row: T, where: Record<string, any>) =>
    Object.entries(where).every(([key, value]) => {
      if (value && typeof value === 'object' && '_type' in value) {
        if (value._type === 'in') return value._value.includes(row[key]);
        if (value._type === 'isNull') return row[key] == null;
        return true;
      }
      return row[key] === value;
    });
  return {
    rows,
    find: jest.fn(async (opts: any = {}) =>
      rows.filter((row) => matches(row, opts.where ?? {})),
    ),
    findOne: jest.fn(
      async (opts: any) =>
        rows.find((row) => matches(row, opts.where ?? {})) ?? null,
    ),
    count: jest.fn(
      async (opts: any = {}) =>
        rows.filter((row) => matches(row, opts.where ?? {})).length,
    ),
    update: jest.fn(async (where: any, patch: any) => {
      const hit = rows.filter((row) => matches(row, where));
      for (const row of hit) Object.assign(row, patch);
      return { affected: hit.length };
    }),
    createQueryBuilder: jest.fn(() => {
      let values: T[] = [];
      const chain: any = {
        insert: () => chain,
        values: (v: T | T[]) => {
          values = Array.isArray(v) ? v : [v];
          return chain;
        },
        orIgnore: () => chain,
        execute: async () => {
          const added = values.map((v, i) => {
            rows.push({ id: `row-${rows.length + i}`, ...v });
            return { id: 'x' };
          });
          return { identifiers: added };
        },
      };
      return chain;
    }),
  };
}

function build(
  overrides: {
    links?: any[];
    releases?: any[];
    opportunities?: any[];
    builderPrs?: any[];
    github?: Record<string, any>;
  } = {},
) {
  const links = table(overrides.links ?? []);
  const releases = table(overrides.releases ?? []);
  const builderPrs = table(overrides.builderPrs ?? []);
  const opportunities = table(
    overrides.opportunities ?? [
      {
        id: 'o-1',
        code: 'OPP-0388',
        stage: RoadmapOpportunityStage.PRIORITISED,
        builderSessionId: 's-1',
      },
    ],
  );
  const github = {
    isConfigured: true,
    fullRepo: (repo: string) => (repo.includes('/') ? repo : MONO),
    listCompletedRuns: jest.fn(async () => [
      {
        id: '1',
        htmlUrl: '',
        conclusion: 'success',
        createdAt: new Date('2026-11-11T09:00:00Z'),
        startedAt: new Date('2026-11-11T09:00:00Z'),
        finishedAt: new Date('2026-11-11T09:20:00Z'),
        headSha: 'release-head',
        title: 'Production Release - Ally Backend',
      },
    ]),
    listTagRefs: jest.fn(async () => [
      { name: 'be-v1.2.0', sha: 'tag-obj-0', type: 'tag' },
      { name: 'be-v1.2.1', sha: 'tag-obj-1', type: 'tag' },
    ]),
    resolveTag: jest.fn(async (_repo: string, ref: any) =>
      ref.name === 'be-v1.2.1'
        ? { commitSha: 'c1', at: new Date('2026-11-11T09:00:30Z') }
        : { commitSha: 'c0', at: new Date('2026-11-01T09:00:30Z') },
    ),
    compareStatus: jest.fn(async () => 'behind'),
    getPullRequest: jest.fn(),
    getPullRequestSummary: jest.fn(),
    listPullRequestFiles: jest.fn(),
    listPullRequests: jest.fn(async () => []),
    ...overrides.github,
  };
  const config = {
    githubOrg: 'HelloAllyTech',
    githubMonorepo: 'ally-platform',
  };
  const lockRunner = {
    connect: jest.fn(),
    release: jest.fn(),
    query: jest.fn(async (sql: string) =>
      sql.includes('pg_try_advisory_lock') ? [{ locked: true }] : [],
    ),
  };
  const dataSource = {
    query: jest.fn(async () => []),
    createQueryRunner: jest.fn(() => lockRunner),
  };
  const service = new ItemReleaseService(
    links as never,
    releases as never,
    builderPrs as never,
    opportunities as never,
    github as never,
    config as never,
    dataSource as never,
  );
  (service as any).logger = { info: jest.fn(), warn: jest.fn() };
  return {
    service,
    links,
    releases,
    opportunities,
    github,
    dataSource,
    lockRunner,
  };
}

const pendingRow = (extra: Record<string, any> = {}) => ({
  id: 'r-1',
  opportunityId: 'o-1',
  repo: MONO,
  prNumber: 12,
  service: 'be',
  apps: null,
  mergeSha: MERGE_SHA,
  mergedAt: merged,
  state: ItemReleaseState.PENDING,
  checkedRef: null,
  ...extra,
});

const mergedLink = (extra: Record<string, any> = {}) => ({
  id: 'l-1',
  opportunityId: 'o-1',
  repo: MONO,
  prNumber: 12,
  source: ItemLinkSource.BUILDER,
  state: ItemLinkState.MERGED,
  servicesResolvedAt: new Date(),
  ...extra,
});

describe('ItemReleaseService.evaluateReleases', () => {
  it('marks a merge live when the newest successful release tag contains it', async () => {
    const { service, releases, github } = build({ releases: [pendingRow()] });

    expect(await service.evaluateReleases()).toBe(1);

    // Compared against the tag the successful run made, not the newest tag.
    expect(github.compareStatus).toHaveBeenCalledWith(
      'ally-be',
      'be-v1.2.1',
      MERGE_SHA,
    );
    expect(releases.rows[0]).toMatchObject({
      state: ItemReleaseState.LIVE,
      tag: 'be-v1.2.1',
      releasedAt: new Date('2026-11-11T09:20:00Z'),
    });
  });

  it('leaves a merge pending when the release does not contain it', async () => {
    const { service, releases } = build({
      releases: [pendingRow()],
      github: { compareStatus: jest.fn(async () => 'ahead') },
    });

    expect(await service.evaluateReleases()).toBe(0);
    expect(releases.rows[0]).toMatchObject({
      state: ItemReleaseState.PENDING,
      checkedRef: 'be-v1.2.1',
    });
  });

  it('does not compare again until the service releases something new', async () => {
    const { service, github } = build({
      releases: [pendingRow({ checkedRef: 'be-v1.2.1' })],
    });

    await service.evaluateReleases();

    expect(github.compareStatus).not.toHaveBeenCalled();
  });

  it('calls a merge failed when the release after it failed', async () => {
    const { service, releases } = build({
      releases: [pendingRow({ mergedAt: new Date('2026-11-11T10:00:00Z') })],
      github: {
        compareStatus: jest.fn(async () => 'ahead'),
        listCompletedRuns: jest.fn(async () => [
          {
            id: '1',
            htmlUrl: '',
            conclusion: 'success',
            createdAt: new Date('2026-11-11T09:00:00Z'),
            startedAt: new Date('2026-11-11T09:00:00Z'),
            finishedAt: new Date('2026-11-11T09:20:00Z'),
            headSha: 'h1',
            title: '',
          },
          {
            id: '2',
            htmlUrl: '',
            conclusion: 'failure',
            createdAt: new Date('2026-11-11T11:00:00Z'),
            startedAt: new Date('2026-11-11T11:00:00Z'),
            finishedAt: new Date('2026-11-11T11:20:00Z'),
            headSha: 'h2',
            title: '',
          },
        ]),
      },
    });

    await service.evaluateReleases();

    expect(releases.rows[0].state).toBe(ItemReleaseState.FAILED);
  });

  it('waits when GitHub cannot answer the compare', async () => {
    const { service, releases } = build({
      releases: [pendingRow()],
      github: { compareStatus: jest.fn(async () => null) },
    });

    await service.evaluateReleases();

    expect(releases.rows[0].state).toBe(ItemReleaseState.PENDING);
    // Not recorded as checked, so the next pass tries again.
    expect(releases.rows[0].checkedRef).toBeNull();
  });

  it('waits when the service has no readable successful release', async () => {
    const { service, releases, github } = build({
      releases: [pendingRow()],
      github: { listCompletedRuns: jest.fn(async () => null) },
    });

    await service.evaluateReleases();

    expect(github.compareStatus).not.toHaveBeenCalled();
    expect(releases.rows[0].state).toBe(ItemReleaseState.PENDING);
  });

  it('needs both dashboards for a change to shared frontend code', async () => {
    const frontendRun = (apps: string, tag: string, hour: number) => ({
      id: tag,
      htmlUrl: '',
      conclusion: 'success',
      createdAt: new Date(Date.UTC(2026, 10, 11, hour)),
      startedAt: new Date(Date.UTC(2026, 10, 11, hour)),
      finishedAt: new Date(Date.UTC(2026, 10, 11, hour, 20)),
      headSha: `h-${tag}`,
      title: `Production Release - Frontends ${tag} [apps=${apps}]`,
    });
    const compareStatus = jest.fn(async (_repo: string, base: string) =>
      base === 'frontend-v1.0.2' ? 'behind' : 'ahead',
    );
    const { service, releases } = build({
      releases: [pendingRow({ service: 'frontend', apps: 'both' })],
      github: {
        compareStatus,
        listCompletedRuns: jest.fn(async () => [
          frontendRun('helpline', 'frontend-v1.0.1', 11),
          frontendRun('admin', 'frontend-v1.0.2', 12),
        ]),
      },
    });

    await service.evaluateReleases();

    // Live on admin, not yet on helpline: not live.
    expect(compareStatus).toHaveBeenCalledWith(
      'ally-web',
      'frontend-v1.0.2',
      MERGE_SHA,
    );
    expect(compareStatus).toHaveBeenCalledWith(
      'ally-web',
      'frontend-v1.0.1',
      MERGE_SHA,
    );
    expect(releases.rows[0].state).toBe(ItemReleaseState.PENDING);
  });

  it('only evaluates rows of opportunities still in flight', async () => {
    const { service, github } = build({
      releases: [pendingRow()],
      opportunities: [
        {
          id: 'o-1',
          code: 'OPP-0388',
          stage: RoadmapOpportunityStage.ARCHIVED,
        },
      ],
    });

    await service.evaluateReleases();

    expect(github.listCompletedRuns).not.toHaveBeenCalled();
  });
});

describe('ItemReleaseService.releaseShipped', () => {
  const withLinkedIds = (built: ReturnType<typeof build>, ids: string[]) => {
    built.links.createQueryBuilder = jest.fn(() => {
      const chain: any = {
        select: () => chain,
        innerJoin: () => chain,
        where: () => chain,
        getRawMany: async () => ids.map((opportunityId) => ({ opportunityId })),
      };
      return chain;
    }) as never;
    return built;
  };

  /**
   * Released is a person's click (lifecycle 2026-11-18): the watcher counts
   * the ideas whose work is all live, for the builder to mark, and never
   * moves one itself.
   */
  it('counts an opportunity once every service is live, but never marks it released', async () => {
    const built = withLinkedIds(
      build({
        links: [mergedLink()],
        releases: [
          pendingRow({
            state: ItemReleaseState.LIVE,
            releasedAt: new Date('2026-11-11T09:20:00Z'),
          }),
        ],
      }),
      ['o-1'],
    );

    expect(await built.service.releaseShipped()).toBe(1);
    expect(built.opportunities.update).not.toHaveBeenCalled();
  });

  /**
   * The bug this phase fixes. Builder records `skipped` when it did not
   * release a merged pull request itself, and the old reconcile counted that
   * as delivered. Now only a successful release that contains the merge does.
   */
  it('does not release a merged Builder PR marked skipped that no release contains', async () => {
    const built = build({
      builderPrs: [
        {
          sessionId: 's-1',
          repo: 'ally-be',
          prNumber: 12,
          prUrl: `https://github.com/${MONO}/pull/12`,
          branch: 'builder/x',
          merged: true,
          state: 'closed',
          mergedAt: merged,
          releaseState: 'skipped',
        },
      ],
      releases: [pendingRow()],
      github: { compareStatus: jest.fn(async () => 'ahead') },
    });

    await built.service.syncBuilderLinks();
    // The link is recorded from Builder's row; its releaseState plays no part.
    expect(built.links.rows[0]).toMatchObject({
      repo: MONO,
      prNumber: 12,
      state: ItemLinkState.MERGED,
      source: ItemLinkSource.BUILDER,
    });
    built.links.rows[0].servicesResolvedAt = new Date();

    await built.service.evaluateReleases();
    withLinkedIds(built, ['o-1']);
    expect(await built.service.releaseShipped()).toBe(0);
    expect(built.opportunities.update).not.toHaveBeenCalled();
  });

  /**
   * OPP-style codes ride every slice of a multi-PR feature. A New idea whose
   * code appears in one PR that has gone live is not shipped: only a Builder
   * or hand-made link can release it.
   */
  it('leaves a New opportunity linked only by a code match unreleased, even when its PR is live', async () => {
    const built = withLinkedIds(
      build({
        opportunities: [
          { id: 'o-1', code: 'OPP-0388', stage: RoadmapOpportunityStage.NEW },
        ],
        links: [mergedLink({ source: ItemLinkSource.CODE_MATCH })],
        releases: [
          pendingRow({
            state: ItemReleaseState.LIVE,
            releasedAt: new Date('2026-11-11T09:20:00Z'),
          }),
        ],
      }),
      ['o-1'],
    );

    expect(await built.service.releaseShipped()).toBe(0);
    expect(built.opportunities.update).not.toHaveBeenCalled();
    expect(built.opportunities.rows[0].stage).toBe(RoadmapOpportunityStage.NEW);
  });

  it('counts the same opportunity as live once the PR is linked by hand', async () => {
    const built = withLinkedIds(
      build({
        opportunities: [
          { id: 'o-1', code: 'OPP-0388', stage: RoadmapOpportunityStage.NEW },
        ],
        links: [mergedLink({ source: ItemLinkSource.MANUAL })],
        releases: [pendingRow({ state: ItemReleaseState.LIVE })],
      }),
      ['o-1'],
    );

    expect(await built.service.releaseShipped()).toBe(1);
  });

  /**
   * P4 (D18): once the brief went to Claude Code, the work arrives only as
   * PRs carrying the code, so those drive release like Builder's own.
   */
  it('counts a live code-matched PR once the brief was sent to Claude Code', async () => {
    const built = withLinkedIds(
      build({
        opportunities: [
          { id: 'o-1', code: 'OPP-0388', stage: RoadmapOpportunityStage.NEW },
        ],
        links: [mergedLink({ source: ItemLinkSource.CODE_MATCH })],
        releases: [pendingRow({ state: ItemReleaseState.LIVE })],
      }),
      ['o-1'],
    );
    built.dataSource.query.mockImplementation((async (sql: string) =>
      sql.includes('externalBuild') ? [{ id: 'o-1' }] : []) as never);

    expect(await built.service.releaseShipped()).toBe(1);
  });

  it('still holds an externally built idea while a code-matched PR is open', async () => {
    const built = withLinkedIds(
      build({
        links: [
          mergedLink({ source: ItemLinkSource.CODE_MATCH }),
          mergedLink({
            id: 'l-2',
            prNumber: 13,
            source: ItemLinkSource.CODE_MATCH,
            state: ItemLinkState.OPEN,
          }),
        ],
        releases: [pendingRow({ state: ItemReleaseState.LIVE })],
      }),
      ['o-1'],
    );
    built.dataSource.query.mockImplementation((async (sql: string) =>
      sql.includes('externalBuild') ? [{ id: 'o-1' }] : []) as never);

    expect(await built.service.releaseShipped()).toBe(0);
  });

  it('does not release while a linked PR is still open', async () => {
    const built = withLinkedIds(
      build({
        links: [
          mergedLink(),
          mergedLink({ id: 'l-2', prNumber: 13, state: ItemLinkState.OPEN }),
        ],
        releases: [pendingRow({ state: ItemReleaseState.LIVE })],
      }),
      ['o-1'],
    );

    expect(await built.service.releaseShipped()).toBe(0);
  });

  it('never writes the stage, even for a row someone already moved', async () => {
    const built = withLinkedIds(
      build({
        links: [mergedLink()],
        releases: [pendingRow({ state: ItemReleaseState.LIVE })],
        opportunities: [
          {
            id: 'o-1',
            code: 'OPP-0388',
            stage: RoadmapOpportunityStage.ARCHIVED,
          },
        ],
      }),
      ['o-1'],
    );

    await built.service.releaseShipped();
    expect(built.opportunities.update).not.toHaveBeenCalled();
    expect(built.opportunities.rows[0].stage).toBe(
      RoadmapOpportunityStage.ARCHIVED,
    );
  });
});

describe('ItemReleaseService.syncMergedCodeLinks', () => {
  it('links a merged PR naming the code and writes a row per touched service', async () => {
    const built = build();
    built.dataSource.query.mockResolvedValueOnce([
      {
        repo: 'ally-be',
        pr_number: 40,
        pr_url: `https://github.com/${MONO}/pull/40`,
        head_ref: 'feat/opp-388-thing',
        head_sha: 'm40',
        merged_at: merged,
        title: 'feat(x): the thing',
        files: [
          'ally-be/src/a.ts',
          'ally-web/apps/ally-admin-dashboard/x.tsx',
          'helloallytech.github.io/wiki/x.md',
        ],
        files_truncated: false,
      },
    ] as never);

    expect(await built.service.syncMergedCodeLinks()).toBe(1);

    expect(built.links.rows[0]).toMatchObject({
      opportunityId: 'o-1',
      repo: MONO,
      prNumber: 40,
      source: ItemLinkSource.CODE_MATCH,
      state: ItemLinkState.MERGED,
      mergeSha: 'm40',
    });
    expect(built.links.rows[0].servicesResolvedAt).toBeInstanceOf(Date);
    expect(
      built.releases.rows.map((row) => [row.service, row.apps, row.state]),
    ).toEqual([
      ['be', null, ItemReleaseState.PENDING],
      ['frontend', 'admin', ItemReleaseState.PENDING],
    ]);
    // Read from the merge journal: no GitHub call needed.
    expect(built.github.getPullRequest).not.toHaveBeenCalled();
  });

  it('leaves the services unresolved when the journal has no file list', async () => {
    const built = build();
    built.dataSource.query.mockResolvedValueOnce([
      {
        repo: 'ally-be',
        pr_number: 41,
        pr_url: `https://github.com/${MONO}/pull/41`,
        head_ref: 'x',
        head_sha: 'm41',
        merged_at: merged,
        title: 'fix: y (OPP-0388)',
        files: [],
        files_truncated: true,
      },
    ] as never);

    await built.service.syncMergedCodeLinks();

    expect(built.links.rows[0].servicesResolvedAt).toBeUndefined();
    expect(built.releases.rows).toHaveLength(0);
  });

  it('ignores a code no opportunity has', async () => {
    const built = build();
    built.dataSource.query.mockResolvedValueOnce([
      {
        repo: 'ally-be',
        pr_number: 42,
        pr_url: null,
        head_ref: null,
        head_sha: 'm42',
        merged_at: merged,
        title: 'OPP-9999',
        files: ['ally-be/a.ts'],
        files_truncated: false,
      },
    ] as never);

    expect(await built.service.syncMergedCodeLinks()).toBe(0);
    expect(built.links.rows).toHaveLength(0);
  });
});

describe('ItemReleaseService.linkPullRequests', () => {
  it('links a pull request by number to the monorepo', async () => {
    const built = build({
      github: {
        getPullRequest: jest.fn(async () => ({
          merged: false,
          state: 'open',
          htmlUrl: `https://github.com/${MONO}/pull/77`,
          headRef: 'feat/x',
          mergedAt: null,
        })),
      },
    });
    jest.spyOn(built.service, 'reconcile').mockResolvedValue(null);

    const response = await built.service.linkPullRequests(7, 'opp-388', [
      '#77',
    ]);

    expect(built.github.getPullRequest).toHaveBeenCalledWith(MONO, 77);
    expect(built.links.rows[0]).toMatchObject({
      source: ItemLinkSource.MANUAL,
      state: ItemLinkState.OPEN,
      createdBy: 7,
    });
    expect(response.code).toBe('OPP-0388');
    expect(response.linkedPrs).toHaveLength(1);
  });

  it('refuses a repository outside the organisation', async () => {
    const built = build();
    await expect(
      built.service.linkPullRequests(7, 'OPP-0388', [
        'https://github.com/someone/else/pull/1',
      ]),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses what is not a pull request', async () => {
    const built = build();
    await expect(
      built.service.linkPullRequests(7, 'OPP-0388', ['not a pr']),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('404s an unknown code', async () => {
    const built = build();
    await expect(
      built.service.linkPullRequests(7, 'OPP-0001', ['1']),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ItemReleaseService locking', () => {
  it('skips the pass when another one holds the lock', async () => {
    const built = build();
    built.lockRunner.query.mockResolvedValueOnce([{ locked: false }] as never);
    const sync = jest.spyOn(built.service, 'syncBuilderLinks');

    expect(await built.service.reconcile()).toBeNull();
    expect(sync).not.toHaveBeenCalled();
    expect(built.lockRunner.release).toHaveBeenCalled();
  });

  it('records links but decides nothing without GitHub', async () => {
    const built = build({ github: { isConfigured: false } });
    const evaluate = jest.spyOn(built.service, 'evaluateReleases');

    await built.service.reconcile();

    expect(evaluate).not.toHaveBeenCalled();
  });
});
