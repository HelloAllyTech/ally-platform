import {
  isMonorepoService,
  pathWithinService,
  repoFromGithubUrl,
  repoName,
  serviceForPath,
} from '../github-repos.constants';

/**
 * Paths and stored URLs after the 2026-10-23 cutover: a monorepo path names
 * its service by its first folder, and a stored URL keeps the repo it was
 * written against.
 */
describe('github-repos', () => {
  it('knows the five services that moved, and nothing else', () => {
    for (const service of [
      'ally-be',
      'ally-web',
      'ally-ai',
      'ally-ai-learn',
      'ally-mobile',
    ]) {
      expect(isMonorepoService(service)).toBe(true);
    }
    expect(isMonorepoService('ally-platform')).toBe(false);
    expect(isMonorepoService('ally-changelog')).toBe(false);
  });

  it('reads the service from a monorepo path, and nothing from a root file', () => {
    expect(serviceForPath('ally-web/apps/ally-admin-dashboard/src/x.tsx')).toBe(
      'ally-web',
    );
    expect(serviceForPath('./ally-be/src/main.ts')).toBe('ally-be');
    expect(serviceForPath('.github/workflows/test-ally-be.yml')).toBeNull();
    expect(serviceForPath('helloallytech.github.io/wiki/memory.md')).toBeNull();
    expect(serviceForPath('apps/ally-admin-dashboard/x.ts')).toBeNull();
    expect(serviceForPath(null)).toBeNull();
  });

  /** `ally-ai` is a prefix of `ally-ai-learn`; the folder match must be whole. */
  it('does not mistake ally-ai-learn for ally-ai', () => {
    expect(serviceForPath('ally-ai-learn/app/worker.py')).toBe('ally-ai-learn');
    expect(pathWithinService('ally-ai-learn/app/worker.py')).toBe(
      'app/worker.py',
    );
  });

  it('strips the service folder, and leaves a pre-move path alone', () => {
    expect(pathWithinService('ally-web/apps/ally-admin-dashboard/x.ts')).toBe(
      'apps/ally-admin-dashboard/x.ts',
    );
    expect(pathWithinService('apps/ally-admin-dashboard/x.ts')).toBe(
      'apps/ally-admin-dashboard/x.ts',
    );
  });

  /**
   * The owner is the point: `GithubActionsService.fullRepo` passes
   * "owner/name" through, so a pre-move URL is read from the archived repo
   * instead of the monorepo PR that happens to share its number.
   */
  it('keeps the owner and repo a stored URL names, archived or not', () => {
    expect(
      repoFromGithubUrl('https://github.com/HelloAllyTech/ally-be/pull/686'),
    ).toBe('HelloAllyTech/ally-be');
    expect(
      repoFromGithubUrl(
        'https://github.com/HelloAllyTech/ally-platform/compare/abc...def',
      ),
    ).toBe('HelloAllyTech/ally-platform');
    expect(repoFromGithubUrl('not a url')).toBeNull();
    expect(repoFromGithubUrl(undefined)).toBeNull();
  });

  it('takes the name off an owner/name, or returns a bare name as it is', () => {
    expect(repoName('HelloAllyTech/ally-platform')).toBe('ally-platform');
    expect(repoName('ally-platform')).toBe('ally-platform');
  });
});
