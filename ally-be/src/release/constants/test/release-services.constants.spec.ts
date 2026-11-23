import { readFileSync } from 'fs';
import { join } from 'path';

import {
  MOBILE_PROMOTE_WORKFLOW,
  RELEASE_SERVICES,
  releaseServiceForPath,
  releaseServiceForRepo,
  touchedServices,
} from '../release-services.constants';
import { RELEASE_TARGETS } from '../release-targets.constants';

const MONO = 'ally-platform';

describe('releaseServiceForPath', () => {
  it.each([
    ['ally-be/src/app.module.ts', 'be', null],
    ['ally-ai/app/main.py', 'ai', null],
    ['ally-ai-learn/app/worker.py', 'learn', null],
    ['ally-mobile/lib/main.dart', 'mobile', null],
    ['ally-web/apps/ally-admin-dashboard/src/x.tsx', 'frontend', 'admin'],
    ['ally-web/apps/ally-helpline-dashboard/src/x.tsx', 'frontend', 'helpline'],
    ['ally-web/libs/ui-shared/src/x.ts', 'frontend', 'both'],
    ['ally-web/package.json', 'frontend', 'both'],
  ])('%s → %s', (path, service, apps) => {
    expect(releaseServiceForPath(path)).toEqual({ service, apps });
  });

  it.each([
    '.github/workflows/test-ally-be.yml',
    'helloallytech.github.io/wiki/index.md',
    'scripts/x.sh',
    'README.md',
    // ally-be-ish prefixes are not ally-be.
    'ally-be-notes/x.md',
    // The retired marketing site ships in neither dashboard.
    'ally-web/apps/ally-web/page.tsx',
  ])('%s belongs to no service', (path) => {
    expect(releaseServiceForPath(path)).toBeNull();
  });
});

describe('releaseServiceForRepo', () => {
  it('reads Builder service keys and pre-cutover repo names alike', () => {
    expect(releaseServiceForRepo('ally-be')).toBe('be');
    expect(releaseServiceForRepo('HelloAllyTech/ally-ai-learn')).toBe('learn');
    expect(releaseServiceForRepo('ally-web')).toBe('frontend');
    expect(releaseServiceForRepo('HelloAllyTech/ally-platform')).toBeNull();
    expect(releaseServiceForRepo('infra')).toBeNull();
    expect(releaseServiceForRepo(null)).toBeNull();
  });
});

describe('touchedServices', () => {
  const mono = (files: string[]) =>
    touchedServices({ repo: `HelloAllyTech/${MONO}`, monorepo: MONO, files });

  it('lists every service a monorepo pull request touched, once', () => {
    expect(
      mono([
        'ally-be/src/a.ts',
        'ally-be/src/b.ts',
        'ally-web/apps/ally-admin-dashboard/x.tsx',
        '.github/workflows/x.yml',
      ]),
    ).toEqual([
      { service: 'be', apps: null },
      { service: 'frontend', apps: 'admin' },
    ]);
  });

  it('widens admin + helpline to both', () => {
    expect(
      mono([
        'ally-web/apps/ally-admin-dashboard/x.tsx',
        'ally-web/apps/ally-helpline-dashboard/y.tsx',
      ]),
    ).toEqual([{ service: 'frontend', apps: 'both' }]);
  });

  it('says a docs-only pull request ships in nothing', () => {
    expect(mono(['helloallytech.github.io/wiki/x.md'])).toEqual([
      { service: 'none', apps: null },
    ]);
  });

  it('says nothing at all when the file list is unknown', () => {
    expect(mono([])).toEqual([]);
  });

  it('reads a pre-cutover pull request by its repo', () => {
    expect(
      touchedServices({
        repo: 'HelloAllyTech/ally-be',
        monorepo: MONO,
        files: ['src/a.ts'],
      }),
    ).toEqual([{ service: 'be', apps: null }]);
    expect(
      touchedServices({
        repo: 'HelloAllyTech/ally-web',
        monorepo: MONO,
        files: ['apps/ally-helpline-dashboard/x.tsx'],
      }),
    ).toEqual([{ service: 'frontend', apps: 'helpline' }]);
  });
});

describe('RELEASE_SERVICES', () => {
  /**
   * The prefixes are only right while the workflows agree. Read the
   * workflows themselves so a renamed tag series fails here, not silently in
   * production as "never released".
   */
  const workflows = join(__dirname, '../../../../../.github/workflows');

  it.each([
    ['be', 'production-release-ally-be.yaml'],
    ['ai', 'production-release-ally-ai.yaml'],
    ['learn', 'production-release-ally-ai-learn.yaml'],
    ['frontend', 'production-release-frontends.yaml'],
  ] as const)(
    '%s matches the tag its release workflow validates',
    (service, file) => {
      const yaml = readFileSync(join(workflows, file), 'utf8');
      const prefix = RELEASE_SERVICES[service].tagPrefix;
      expect(yaml).toContain(`^${prefix}[0-9]`);
    },
  );

  it('mobile matches the tag the scheduled mobile release pushes', () => {
    const yaml = readFileSync(
      join(workflows, 'scheduled-mobile-release.yml'),
      'utf8',
    );
    expect(yaml).toContain(`git tag "${RELEASE_SERVICES.mobile.tagPrefix}`);
  });

  it.each(Object.entries(RELEASE_SERVICES))(
    '%s names a workflow that exists',
    (_service, spec) => {
      expect(() =>
        readFileSync(join(workflows, spec.workflow), 'utf8'),
      ).not.toThrow();
    },
  );

  it('names a mobile promotion workflow that exists', () => {
    expect(() =>
      readFileSync(join(workflows, MOBILE_PROMOTE_WORKFLOW), 'utf8'),
    ).not.toThrow();
  });

  it('agrees with the dispatch table on every shared prefix', () => {
    expect(RELEASE_TARGETS['ally-be'].tagPrefix).toBe(
      RELEASE_SERVICES.be.tagPrefix,
    );
    expect(RELEASE_TARGETS['ally-web:admin'].tagPrefix).toBe(
      RELEASE_SERVICES.frontend.tagPrefix,
    );
  });
});
