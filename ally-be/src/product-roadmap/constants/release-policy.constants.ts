import { ReleaseServiceKey } from 'src/release/constants/release-services.constants';

/**
 * The auto-release policy (Roadmap v2, P5; plan §5.5, decisions D5 and D6).
 */

/**
 * Paths that hold a service's auto-release for an explicit Release click
 * (plan §5.5.1): DB migrations, auth and permissions, payments and billing.
 *
 * The Owner-editable list lives in settings (`autoReleaseHeldPaths`, P0); this
 * is what an empty setting means, and `release-policy.util.spec` pins it so a
 * default can't be loosened by accident.
 *
 * Globs over monorepo paths, case-insensitive. `*` stays inside one folder,
 * `**` crosses any number of them, and a pattern that names a folder covers
 * everything under it (`**\/*payment*` holds `x/payments/y.ts`).
 */
export const DEFAULT_AUTO_RELEASE_HELD_PATHS: readonly string[] = [
  'ally-be/src/database/migrations/**',
  '**/auth/**',
  '**/authorization/**',
  // Permission and role constants (the `**/authorization/**` rule already
  // covers ally-be's own permissions.constants.ts).
  '**/*permission*.constants.ts',
  '**/permissions.ts',
  '**/*roles.constants.ts',
  'ally-be/src/common/constants/user.constants.ts',
  'ally-web/apps/ally-admin-dashboard/src/constants/user.ts',
  '**/*payment*',
  '**/*billing*',
];

/**
 * The services the policy releases: the three backends, then the frontends.
 * ally-mobile ships through the store pipeline (a scheduled build, then a
 * promotion), which no production-release workflow dispatches, so the policy
 * neither plans nor releases it.
 */
export const RELEASE_POLICY_BACKENDS = ['be', 'ai', 'learn'] as const;
export const RELEASE_POLICY_SERVICES = [
  ...RELEASE_POLICY_BACKENDS,
  'frontend',
] as const;
export type PolicyServiceKey = (typeof RELEASE_POLICY_SERVICES)[number];

export function isPolicyServiceKey(
  value: string | null | undefined,
): value is PolicyServiceKey {
  return (RELEASE_POLICY_SERVICES as readonly string[]).includes(value ?? '');
}

export function isBackendService(service: ReleaseServiceKey): boolean {
  return (RELEASE_POLICY_BACKENDS as readonly string[]).includes(service);
}

/** Wait this long after the last merge to a service, so a burst of merges is one release (§5.5.3). */
export const RELEASE_DEBOUNCE_MS = 10 * 60_000;

/** Consecutive failed or unhealthy auto-releases that open the circuit breaker (D6). */
export const RELEASE_BREAKER_THRESHOLD = 2;

/**
 * A backend release this recent that has not answered its health check yet
 * keeps the frontends waiting. Longer than a release takes, short enough that
 * a health URL nobody configured cannot hold the frontends for a day.
 */
export const BACKEND_HEALTH_WAIT_MS = 2 * 60 * 60_000;

/** Health checks per released service, one per policy pass, before it counts as unhealthy. */
export const RELEASE_HEALTH_ATTEMPTS = 3;

/**
 * Commit file listings read per pass. Each commit is read once and cached (a
 * commit never changes), so this only bounds the first pass after a long
 * quiet stretch; a range not fully read is `unknown` until the next pass.
 */
export const COMMIT_FILE_READS_PER_PASS = 150;

/** Cached commit file listings kept in memory. */
export const COMMIT_FILE_CACHE_SIZE = 5000;
