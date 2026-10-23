import {
  issueRepoOf,
  prRepoOf,
  workflowRunRepoOf,
} from '../builder-github-location.util';

/**
 * Builder's rows name a service; a stored URL names where the thing actually
 * lives. Since the 2026-10-23 cutover a bare service name is routed to the
 * monorepo, so the URL — owner and all — is what a stored reference is read by.
 */
describe('builder GitHub locations', () => {
  it('reads a pull request where its URL says, archived or monorepo', () => {
    expect(
      prRepoOf({
        repo: 'ally-be',
        prUrl: 'https://github.com/HelloAllyTech/ally-be/pull/686',
      }),
    ).toBe('HelloAllyTech/ally-be');
    expect(
      prRepoOf({
        repo: 'ally-be',
        prUrl: 'https://github.com/HelloAllyTech/ally-platform/pull/12',
      }),
    ).toBe('HelloAllyTech/ally-platform');
  });

  it('falls back to the service, which routes to the monorepo', () => {
    expect(prRepoOf({ repo: 'ally-web', prUrl: null })).toBe('ally-web');
    expect(issueRepoOf({ issueUrl: null, repos: ['ally-ai'] })).toBe('ally-ai');
    expect(issueRepoOf({ issueUrl: null, repos: [] })).toBeNull();
  });

  it("reads an issue build's and a workflow run's repo from their URLs", () => {
    expect(
      issueRepoOf({
        issueUrl: 'https://github.com/HelloAllyTech/ally-platform/issues/7',
        repos: ['ally-web'],
      }),
    ).toBe('HelloAllyTech/ally-platform');
    expect(
      workflowRunRepoOf(
        {
          githubRunUrl:
            'https://github.com/HelloAllyTech/ally-be/actions/runs/123',
        },
        'ally-be',
      ),
    ).toBe('HelloAllyTech/ally-be');
    expect(workflowRunRepoOf({ githubRunUrl: null }, 'ally-be')).toBe(
      'ally-be',
    );
  });
});
