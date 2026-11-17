import { DEFAULT_AUTO_RELEASE_HELD_PATHS } from '../../constants/release-policy.constants';
import { ReleasePlanService } from '../release-plan.service';

/**
 * Building plans from GitHub reads: the base is each service's newest
 * successful release, the range is classified against one read of master,
 * and the ideas come from linked pull requests in the range.
 */

const graphCommit = (
  sha: string,
  parents: string[],
  message: string,
  at = '2026-11-17T08:00:00Z',
) => ({
  sha,
  parents,
  message,
  authorLogin: 'someone',
  committedAt: new Date(at),
});

function build(
  overrides: {
    heads?: Map<string, any>;
    graph?: any;
    files?: Record<string, string[]>;
    links?: any[];
  } = {},
) {
  const files = overrides.files ?? {
    c1: ['ally-be/src/database/migrations/1983900000000-X.ts'],
    c2: ['ally-be/src/roadmap/a.ts'],
  };
  const github = {
    getBranchSha: jest.fn(async () => 'master-sha'),
    compareCommitGraph: jest.fn(
      async () =>
        overrides.graph ?? {
          status: 'ahead',
          truncated: false,
          commits: [
            graphCommit('c1', ['base'], 'migration (#40)'),
            graphCommit('c2', ['c1'], 'feature (#41)', '2026-11-17T09:00:00Z'),
          ],
        },
    ),
    getCommitFiles: jest.fn(async (_repo: string, sha: string) =>
      files[sha] ? { files: files[sha], truncated: false } : null,
    ),
  };
  const heads =
    overrides.heads ??
    new Map<string, any>([
      ['be', { ref: 'be-v1.2.3', tag: 'be-v1.2.3', runs: [] }],
      ['ai', { ref: 'ai-v1.0.0', tag: 'ai-v1.0.0', runs: [] }],
      ['learn', null],
      [
        'frontend:admin',
        { ref: 'frontend-v1.1.0', tag: 'frontend-v1.1.0', runs: [] },
      ],
      [
        'frontend:helpline',
        { ref: 'frontend-v1.0.9', tag: 'frontend-v1.0.9', runs: [] },
      ],
    ]);
  const itemReleaseService = { releaseHeads: jest.fn(async () => heads) };
  const configService = {
    githubMonorepo: 'ally-platform',
    githubOrg: 'HelloAllyTech',
  };
  const linkRepository = {
    find: jest.fn(
      async () =>
        overrides.links ?? [
          { opportunityId: 'opp-2' },
          { opportunityId: 'opp-1' },
        ],
    ),
  };
  const service = new ReleasePlanService(
    github as any,
    itemReleaseService as any,
    configService as any,
    linkRepository as any,
  );
  return { service, github, linkRepository, itemReleaseService };
}

describe('ReleasePlanService', () => {
  it('classifies lastSuccessfulProdTag...master per service and links the ideas in it', async () => {
    const { service, github, linkRepository } = build();
    const { masterSha, plans } = await service.buildPlans(
      DEFAULT_AUTO_RELEASE_HELD_PATHS,
    );

    expect(masterSha).toBe('master-sha');
    expect(github.compareCommitGraph).toHaveBeenCalledWith(
      'ally-platform',
      'be-v1.2.3',
      'master-sha',
    );
    const be = plans.get('be')!;
    expect(be.baseTag).toBe('be-v1.2.3');
    expect(be.commits.map((c) => c.sha)).toEqual(['c1', 'c2']);
    expect(be.heldReasons).toEqual([
      expect.objectContaining({
        sha: 'c1',
        rule: 'ally-be/src/database/migrations/**',
      }),
    ]);
    expect(be.prNumbers).toEqual([40, 41]);
    expect(be.opportunityIds).toEqual(['opp-1', 'opp-2']);
    expect(linkRepository.find).toHaveBeenCalled();

    // The range touched only ally-be: ai has nothing; learn has no readable release.
    expect(plans.get('ai')!.commits).toEqual([]);
    expect(plans.get('learn')!.unknown).toMatch(
      /no successful production release/,
    );
    // Each dashboard is compared from its own base.
    expect(github.compareCommitGraph).toHaveBeenCalledWith(
      'ally-platform',
      'frontend-v1.1.0',
      'master-sha',
    );
    expect(github.compareCommitGraph).toHaveBeenCalledWith(
      'ally-platform',
      'frontend-v1.0.9',
      'master-sha',
    );
  });

  it('reads each commit’s files once across passes', async () => {
    const { service, github } = build();
    await service.buildPlans(DEFAULT_AUTO_RELEASE_HELD_PATHS);
    await service.buildPlans(DEFAULT_AUTO_RELEASE_HELD_PATHS);
    expect(github.getCommitFiles).toHaveBeenCalledTimes(2);
  });

  it('is unknown, not empty, when master or a commit cannot be read', async () => {
    const unreadable = build({ files: {} });
    const { plans } = await unreadable.service.buildPlans(
      DEFAULT_AUTO_RELEASE_HELD_PATHS,
    );
    expect(plans.get('be')!.unknown).toMatch(/could not read the files/);

    const noMaster = build();
    noMaster.github.getBranchSha.mockResolvedValue(null as any);
    const second = await noMaster.service.buildPlans(
      DEFAULT_AUTO_RELEASE_HELD_PATHS,
    );
    expect(second.plans.get('be')!.unknown).toBe('could not read master');
  });

  it('has nothing to release when the release tag is master', async () => {
    const { service } = build({
      graph: { status: 'identical', truncated: false, commits: [] },
    });
    const { plans } = await service.buildPlans(DEFAULT_AUTO_RELEASE_HELD_PATHS);
    expect(plans.get('be')!.commits).toEqual([]);
    expect(plans.get('be')!.unknown).toBeNull();
  });

  it('counts the service commits between two heads, in either direction', async () => {
    const { service, github } = build();
    expect(await service.serviceCommitsBetween('be', 'x', 'x')).toBe(0);
    expect(await service.serviceCommitsBetween('be', 'a', 'b')).toBe(2);
    expect(await service.serviceCommitsBetween('ai', 'a', 'b')).toBe(0);
    github.compareCommitGraph.mockResolvedValueOnce({
      status: 'diverged',
      truncated: false,
      commits: [],
    });
    expect(await service.serviceCommitsBetween('be', 'a', 'b')).toBeNull();
  });
});
