/**
 * Where a file, or a stored GitHub URL, lives after the 2026-10-23 cutover.
 *
 * That day the five service repos were archived and their code moved into one
 * monorepo, a folder per service. `GithubActionsService.fullRepo` handles every
 * call that acts NOW: a service name ("ally-be") is addressed to the monorepo,
 * and a full "owner/name" passes through untouched. Two things it cannot know
 * live here:
 *
 *  - Which service a monorepo PATH belongs to, and what that path looks like in
 *    the service's own terms: `ally-web/apps/x.ts` is `apps/x.ts` to ally-web.
 *    Rules written against a service's own repo keep working on the stripped
 *    path.
 *  - Which repo a STORED URL names. PR numbers restarted at #1 in the
 *    monorepo, so a pull request saved before the move must be read as
 *    "HelloAllyTech/ally-be" — passing "ally-be" would send it to the
 *    monorepo's PR of the same number, a different change, and nothing errors.
 */

/** The services that live as folders in the monorepo. A GitHub call naming one is addressed there. */
export const MONOREPO_SERVICES = [
  'ally-be',
  'ally-web',
  'ally-ai',
  'ally-ai-learn',
  'ally-mobile',
] as const;

export type MonorepoService = (typeof MONOREPO_SERVICES)[number];

export const isMonorepoService = (repo: string): repo is MonorepoService =>
  (MONOREPO_SERVICES as readonly string[]).includes(repo);

/**
 * The service a monorepo path belongs to, from its first folder:
 * `ally-web/apps/x.ts` → `ally-web`. Null for anything outside a service
 * folder — the root `.github/`, `scripts/`, the wiki source — which ships in
 * no service, and for a pre-move path, which has no service folder in front.
 */
export function serviceForPath(
  path: string | null | undefined,
): MonorepoService | null {
  const first = (path ?? '').replace(/^\.?\//, '').split('/')[0];
  return isMonorepoService(first) ? first : null;
}

/**
 * A path as its service sees it: `ally-web/apps/x.ts` → `apps/x.ts`. A path
 * with no service folder in front comes back unchanged, so this is safe on
 * either kind.
 */
export function pathWithinService(path: string): string {
  const service = serviceForPath(path);
  return service ? path.replace(/^\.?\//, '').slice(service.length + 1) : path;
}

/**
 * The "owner/name" any github.com URL names — a pull request, a compare, a
 * commit. Owner included on purpose: `GithubActionsService` passes a full name
 * through unchanged, which is what keeps a stored pre-move URL pointed at the
 * archived repo it was written against.
 */
export function repoFromGithubUrl(
  url: string | null | undefined,
): string | null {
  const match = /github\.com\/([^/]+)\/([^/#?]+)\//.exec(url ?? '');
  return match ? `${match[1]}/${match[2]}` : null;
}

/** The name part of a repo, with or without its owner: `HelloAllyTech/ally-be` → `ally-be`. */
export function repoName(repo: string): string {
  return repo.slice(repo.lastIndexOf('/') + 1);
}
