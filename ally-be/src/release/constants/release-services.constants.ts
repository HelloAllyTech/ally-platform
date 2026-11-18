import {
  MonorepoService,
  isMonorepoService,
  pathWithinService,
  repoName,
  serviceForPath,
} from 'src/github/constants/github-repos.constants';

import { RELEASE_TARGETS } from './release-targets.constants';

/**
 * Which production release a changed file waits on, for deciding when a
 * roadmap item is really live (`ItemReleaseService`).
 *
 * Coarser than `RELEASE_TARGETS`, which is keyed by what can be DISPATCHED: this
 * is keyed by tag series, because "is it live" is answered by asking whether a
 * merge commit is an ancestor of the newest successful release tag. The two
 * frontends share one series (`frontend-v*`, since 2026-11-10), so they are one
 * service here; which app a change touched is carried beside it (`apps`),
 * because an admin-only release does not ship a helpline change.
 *
 * Builder keeps `repo` (`ally-be`, `ally-web`, …) as its own service key, as
 * the monorepo cutover left it; `releaseServiceForRepo` translates.
 */
export const RELEASE_SERVICE_KEYS = [
  'be',
  'ai',
  'learn',
  'frontend',
  'mobile',
] as const;
export type ReleaseServiceKey = (typeof RELEASE_SERVICE_KEYS)[number];

/**
 * A merged change that touched no service folder at all — root CI, scripts,
 * the wiki source. It ships in nothing, so it is live the moment it merges.
 * Kept as a row of its own so "every touched service is live" still has
 * something to say about a docs-only pull request.
 */
export const NO_RELEASE_SERVICE = 'none';
export type ItemReleaseServiceKey =
  | ReleaseServiceKey
  | typeof NO_RELEASE_SERVICE;

export type FrontendApp = 'admin' | 'helpline';
/** Which frontends a change ships in. `both` for shared code and root config. */
export type FrontendApps = FrontendApp | 'both';

export interface ReleaseServiceSpec {
  /** The monorepo folder, which is also the service name GithubActionsService routes to the monorepo. */
  folder: MonorepoService;
  /** The tag series a successful production release leaves behind. */
  tagPrefix: string;
  /**
   * The workflow whose SUCCESSFUL runs say a tag reached production. For
   * ally-mobile that is the Android production build; it reaches users when
   * `MOBILE_PROMOTE_WORKFLOW` promotes it (see `ItemReleaseService`).
   */
  workflow: string;
}

/** Promotes the Play internal-track build to production: the moment a mobile change reaches users. */
export const MOBILE_PROMOTE_WORKFLOW = 'promote-android-production.yml';

/**
 * Tag prefixes as the release workflows validate them
 * (`.github/workflows/production-release-*.yaml`). ally-mobile has no
 * production-release workflow: `scheduled-mobile-release.yml` bumps the
 * version and tags `auto-release/X.Y.Z` before dispatching the store builds.
 */
export const RELEASE_SERVICES: Record<ReleaseServiceKey, ReleaseServiceSpec> = {
  be: {
    folder: 'ally-be',
    tagPrefix: RELEASE_TARGETS['ally-be'].tagPrefix,
    workflow: RELEASE_TARGETS['ally-be'].workflow,
  },
  ai: {
    folder: 'ally-ai',
    tagPrefix: RELEASE_TARGETS['ally-ai'].tagPrefix,
    workflow: RELEASE_TARGETS['ally-ai'].workflow,
  },
  learn: {
    folder: 'ally-ai-learn',
    tagPrefix: RELEASE_TARGETS['ally-ai-learn'].tagPrefix,
    workflow: RELEASE_TARGETS['ally-ai-learn'].workflow,
  },
  frontend: {
    folder: 'ally-web',
    tagPrefix: RELEASE_TARGETS['ally-web:frontends'].tagPrefix,
    workflow: RELEASE_TARGETS['ally-web:frontends'].workflow,
  },
  mobile: {
    folder: 'ally-mobile',
    tagPrefix: 'auto-release/',
    workflow: 'build-android-production-flutter.yml',
  },
};

const SERVICE_BY_FOLDER: Record<MonorepoService, ReleaseServiceKey> = {
  'ally-be': 'be',
  'ally-ai': 'ai',
  'ally-ai-learn': 'learn',
  'ally-web': 'frontend',
  'ally-mobile': 'mobile',
};

/**
 * The service a repo name stands for: Builder's `repo` key (`ally-web`), or a
 * pre-cutover pull request's own repo (`HelloAllyTech/ally-web`). Null for
 * anything that is not one of the five services (infra, the monorepo itself).
 */
export function releaseServiceForRepo(
  repo: string | null | undefined,
): ReleaseServiceKey | null {
  const name = repoName(repo ?? '');
  return isMonorepoService(name) ? SERVICE_BY_FOLDER[name] : null;
}

/**
 * Which frontend app a path inside ally-web ships in. The two dashboards are
 * separate builds; `libs/` and root config are compiled into both. Another
 * app folder (the retired marketing site) ships in neither.
 */
export function frontendAppsForPath(pathInWeb: string): FrontendApps | null {
  if (pathInWeb.startsWith('apps/ally-admin-dashboard/')) return 'admin';
  if (pathInWeb.startsWith('apps/ally-helpline-dashboard/')) return 'helpline';
  if (pathInWeb.startsWith('apps/')) return null;
  return 'both';
}

/** Two app sets combined: admin + helpline is both. */
export function mergeFrontendApps(
  a: FrontendApps | null,
  b: FrontendApps | null,
): FrontendApps | null {
  if (!a) return b;
  if (!b) return a;
  return a === b ? a : 'both';
}

/**
 * A monorepo path → the release it waits on. `ally-be/src/x.ts` → `be`;
 * `ally-web/apps/ally-admin-dashboard/x.tsx` → `frontend` (admin). Null for a
 * path outside every service folder.
 */
export function releaseServiceForPath(
  path: string | null | undefined,
): { service: ReleaseServiceKey; apps: FrontendApps | null } | null {
  const folder = serviceForPath(path);
  if (!folder) return null;
  const service = SERVICE_BY_FOLDER[folder];
  if (service !== 'frontend') return { service, apps: null };
  const apps = frontendAppsForPath(pathWithinService(path ?? ''));
  return apps ? { service, apps } : null;
}

export interface TouchedService {
  service: ItemReleaseServiceKey;
  /** Only for `frontend`. */
  apps: FrontendApps | null;
}

/**
 * Every release a merged pull request waits on, from its changed files.
 *
 * In the monorepo each file's first folder names its service. A pull request
 * from before the 2026-10-23 cutover lives in its service's own (now archived)
 * repo, whose paths carry no service folder, so the repo names the service and
 * the paths only decide which frontend.
 *
 * A pull request whose files all sit outside every service yields one `none`
 * entry: it ships in nothing. An empty file list yields nothing — "unknown",
 * which a caller must not read as "touched nothing".
 */
export function touchedServices(params: {
  /** "owner/name" the pull request lives in. */
  repo: string;
  /** The monorepo's name (`ally-platform`). */
  monorepo: string | null | undefined;
  files: readonly string[];
}): TouchedService[] {
  const { repo, monorepo, files } = params;
  if (files.length === 0) return [];

  const found = new Map<ReleaseServiceKey, FrontendApps | null>();
  const add = (service: ReleaseServiceKey, apps: FrontendApps | null) => {
    found.set(
      service,
      service === 'frontend'
        ? mergeFrontendApps(found.get(service) ?? null, apps)
        : null,
    );
  };

  const inMonorepo = Boolean(monorepo) && repoName(repo) === monorepo;
  if (inMonorepo) {
    for (const file of files) {
      const hit = releaseServiceForPath(file);
      if (hit) add(hit.service, hit.apps);
    }
  } else {
    const service = releaseServiceForRepo(repo);
    if (service === 'frontend') {
      for (const file of files) {
        const apps = frontendAppsForPath(file.replace(/^\.?\//, ''));
        if (apps) add(service, apps);
      }
    } else if (service) {
      add(service, null);
    }
  }

  if (found.size === 0) return [{ service: NO_RELEASE_SERVICE, apps: null }];
  return [...found.entries()].map(([service, apps]) => ({ service, apps }));
}
