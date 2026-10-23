import {
  RELEASE_TARGETS,
  releaseTargetKey,
  resolveMonorepoReleaseTargets,
} from '../release-targets.constants';

describe('releaseTargetKey', () => {
  it('recovers the key every target is configured under', () => {
    for (const [key, target] of Object.entries(RELEASE_TARGETS)) {
      expect(releaseTargetKey(target)).toBe(key);
    }
  });

  it('is null for a target the table does not hold', () => {
    expect(
      releaseTargetKey({
        repo: 'ally-mobile',
        workflow: 'build-ios-production.yml',
        tagPrefix: 'v',
        label: 'x',
      }),
    ).toBeNull();
  });
});

/**
 * What a pull request opened in the monorepo releases. Each file is attributed
 * through its service folder and judged as that service's repo would have
 * judged it; anything outside every service folder ships nowhere, which leaves
 * the call to a person.
 */
describe('resolveMonorepoReleaseTargets', () => {
  it('releases every service a pull request touches', () => {
    expect(
      resolveMonorepoReleaseTargets([
        'ally-be/src/a.ts',
        'ally-be/docs/b.md',
        'ally-web/apps/ally-helpline-dashboard/src/c.tsx',
      ]),
    ).toEqual({
      targets: [
        RELEASE_TARGETS['ally-be'],
        RELEASE_TARGETS['ally-web:helpline'],
      ],
      unresolved: [],
      ambiguous: false,
    });
  });

  it('keeps shared web code ambiguous, as ally-web always did', () => {
    expect(
      resolveMonorepoReleaseTargets(['ally-web/libs/ui-shared/Button.tsx']),
    ).toMatchObject({ targets: [], ambiguous: true });
  });

  it('leaves root files over, so an automatic release stops for a person', () => {
    expect(
      resolveMonorepoReleaseTargets([
        'ally-be/src/a.ts',
        '.github/workflows/test-ally-be.yml',
      ]),
    ).toEqual({
      targets: [RELEASE_TARGETS['ally-be']],
      unresolved: ['.github/workflows/test-ally-be.yml'],
      ambiguous: true,
    });
  });

  it('does not mistake ally-ai-learn for ally-ai', () => {
    expect(
      resolveMonorepoReleaseTargets(['ally-ai-learn/app/worker.py']).targets,
    ).toEqual([RELEASE_TARGETS['ally-ai-learn']]);
  });
});
