import { ChangelogSourceService } from 'src/changelog/service/changelog-source.service';
import { AppConfigService } from 'src/config/config.service';
import { GithubActionsService } from 'src/github/service/github-actions.service';

import { ProductUpdateSourceStatus } from '../../entity/product-update-source.entity';
import { ProductUpdateSourceRepository } from '../../repository/product-update-source.repository';
import { ProductUpdateIngestService } from '../product-update-ingest.service';

jest.mock('src/logger/logger.service', () => ({
  LoggerService: {
    getInstance: jest.fn(() => ({
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      log: jest.fn(),
    })),
  },
}));

/**
 * Enriching a change merged after the 2026-10-23 monorepo move.
 *
 * PR numbers restarted at #1 in ally-platform, so a journal entry whose header
 * names the app (`ally-web`) while its PR lives in ally-platform must be read
 * from the repo its URL names — `ally-web#12` is an older, archived pull
 * request — and attributed by its `ally-web/…` paths.
 */
describe('ProductUpdateIngestService.enrichPending', () => {
  const pending = (overrides: Record<string, unknown>) => ({
    id: 'source-1',
    journalId: 'journal-1',
    status: ProductUpdateSourceStatus.PENDING,
    repo: 'ally-web',
    apps: [],
    mergedAt: new Date('2026-10-24T08:00:00Z'),
    prNumber: 12,
    prUrl: 'https://github.com/HelloAllyTech/ally-platform/pull/12',
    author: 'sandeepmalhotra-ally',
    subjects: ['feat(admin): a thing'],
    body: null,
    headRef: null,
    headSha: null,
    baseSha: null,
    files: [],
    filesTruncated: false,
    enrichAttempts: 0,
    ...overrides,
  });

  let github: {
    isConfigured: boolean;
    getPullRequestSummary: jest.Mock;
    listPullRequestFiles: jest.Mock;
    compareCommits: jest.Mock;
  };
  let sourceRepository: { findByStatus: jest.Mock; save: jest.Mock };
  let service: ProductUpdateIngestService;

  beforeEach(() => {
    github = {
      isConfigured: true,
      getPullRequestSummary: jest.fn(async () => ({
        title: 'feat(admin): a thing',
        body: null,
        headRef: 'feat/a-thing',
        mergeCommitSha: 'abc123',
        authorLogin: 'sandeepmalhotra-ally',
      })),
      listPullRequestFiles: jest.fn(async () => ({
        files: ['ally-web/apps/ally-admin-dashboard/src/pages/X.tsx'],
        truncated: false,
      })),
      compareCommits: jest.fn(),
    };
    sourceRepository = { findByStatus: jest.fn(), save: jest.fn() };
    service = new ProductUpdateIngestService(
      {} as unknown as ChangelogSourceService,
      sourceRepository as unknown as ProductUpdateSourceRepository,
      github as unknown as GithubActionsService,
      { githubMonorepo: 'ally-platform' } as unknown as AppConfigService,
    );
  });

  it('reads the pull request from the repo its URL names, not the journal header', async () => {
    sourceRepository.findByStatus.mockResolvedValue([pending({})]);

    await service.enrichPending(10);

    expect(github.getPullRequestSummary).toHaveBeenCalledWith(
      'HelloAllyTech/ally-platform',
      12,
    );
    expect(github.listPullRequestFiles).toHaveBeenCalledWith(
      'HelloAllyTech/ally-platform',
      12,
    );
  });

  it('attributes a monorepo change by its paths, so it waits on the release that ships it', async () => {
    sourceRepository.findByStatus.mockResolvedValue([pending({})]);

    await service.enrichPending(10);

    expect(sourceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: ProductUpdateSourceStatus.ENRICHED,
        deployables: ['ally-web:admin'],
      }),
    );
  });

  it('still reads a pre-move change from its archived repo', async () => {
    sourceRepository.findByStatus.mockResolvedValue([
      pending({
        repo: 'ally-be',
        prNumber: 686,
        prUrl: 'https://github.com/HelloAllyTech/ally-be/pull/686',
      }),
    ]);
    github.listPullRequestFiles.mockResolvedValue({
      files: ['src/a.service.ts'],
      truncated: false,
    });

    await service.enrichPending(10);

    // "HelloAllyTech/ally-be", not "ally-be": a bare service name is routed
    // to the monorepo, whose #686 is a different pull request.
    expect(github.getPullRequestSummary).toHaveBeenCalledWith(
      'HelloAllyTech/ally-be',
      686,
    );
    expect(sourceRepository.save).toHaveBeenCalledWith(
      expect.objectContaining({ deployables: ['ally-be'] }),
    );
  });
});
