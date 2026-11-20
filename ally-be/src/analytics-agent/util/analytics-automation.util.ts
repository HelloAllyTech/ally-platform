import { createHash } from 'crypto';
import type {
  AnalyticsAutomationAgentRun,
  AnalyticsAutomationPrState,
} from '../entity/analytics-automation-agent-run.entity';

/** Paths an agent may never touch, wherever they sit under an allowed prefix. */
const DENIED_PATH_PATTERNS: readonly RegExp[] = [
  /(^|\/)\.env/i,
  /(^|\/)node_modules\//,
  /(^|\/)\.github\//,
  /(^|\/)\.git\//,
  /(^|\/)migrations\//,
  /(^|\/)package(-lock)?\.json$/,
  /(^|\/)(secrets?|credentials?)[^/]*$/i,
];

/**
 * Whether `path` is a plain repo-relative path inside one of `allowedPrefixes`
 * (a folder ending in "/", or one exact file)
 * and not on the deny list. The model chose the path, so it is checked, not
 * trusted: no `..`, no absolute paths, no backslashes.
 */
export function isAllowedPath(
  path: string,
  allowedPrefixes: readonly string[],
): boolean {
  if (path.length === 0 || path.length > 300) return false;
  if (path.startsWith('/') || path.includes('\\') || path.includes('\0')) {
    return false;
  }
  if (path.split('/').some((part) => part === '..' || part === '')) {
    return false;
  }
  // An entry ending in "/" is a folder; any other entry is exactly one file.
  const inScope = allowedPrefixes.some((entry) =>
    entry.endsWith('/') ? path.startsWith(entry) : path === entry,
  );
  if (!inScope) return false;
  return !DENIED_PATH_PATTERNS.some((pattern) => pattern.test(path));
}

/** Property names that identify or describe a person; never sent to PostHog. */
const PHI_PROPERTY_SEGMENTS =
  /(^|_)(email|phone|address|dob|birthdate|birthday|ssn|password|token|transcript|first_?name|last_?name|full_?name)($|_)/i;
/** Names that, as the WHOLE property, are free text a person wrote or said. */
const FREE_TEXT_PROPERTY_NAMES =
  /^(name|text|content|body|message|note|notes|comment|description|prompt|response|answer|query|summary)$/i;

/**
 * Event properties the PostHog agent must not add. Ally is HIPAA-scoped and
 * its sessions hold what counsellors and clients say, so an event carries
 * identifiers-by-id and counts, never names, contact details or free text.
 * Returns the offending property names (empty when the event is acceptable).
 */
export function findPhiProperties(properties: readonly string[]): string[] {
  return properties.filter(
    (name) =>
      PHI_PROPERTY_SEGMENTS.test(name) || FREE_TEXT_PROPERTY_NAMES.test(name),
  );
}

/** A stable hash of what an item IS, so a re-worded item keeps its identity. */
export function fingerprint(kind: string, key: string): string {
  const normal = key.trim().toLowerCase().replace(/\s+/g, ' ');
  return createHash('sha256').update(`${kind}:${normal}`).digest('hex');
}

/** Branch an agent's pull request is made on. Always under `automation/`. */
export function automationBranch(runId: string, agentSlug: string): string {
  return `automation/${runId.slice(0, 8)}/${agentSlug}`;
}

/**
 * Whether the changed dbt files on their own mean the models must be rebuilt
 * once merged: a model's SQL, or a seed. A yml change may or may not (docs and
 * tests do not; config does), so that is the author's call, OR-ed with this.
 */
export function filesNeedDbtBuild(paths: Iterable<string>): boolean {
  for (const path of paths) {
    if (path.startsWith('models/') && path.endsWith('.sql')) return true;
    if (path.startsWith('seeds/')) return true;
  }
  return false;
}

/** One CI check (a GitHub check run) on a pull request's head commit. */
export interface CheckRun {
  /** For a GitHub Actions job this is also the job id that `get_job_logs` takes. */
  id: number;
  name: string;
  /** `queued`, `in_progress`, `completed`, ... */
  status: string;
  /** Set once `status` is `completed`: `success`, `failure`, `cancelled`, ... */
  conclusion: string | null;
  url: string | null;
}

export type ChecksVerdict =
  | { state: 'none' }
  | { state: 'pending'; pending: string[] }
  | { state: 'green'; count: number }
  | { state: 'failed'; failed: CheckRun[] };

/** A finished check that does not hold the pull request back. */
const PASSING_CONCLUSIONS: ReadonlySet<string> = new Set([
  'success',
  'neutral',
  'skipped',
]);

/**
 * What a pull request's checks add up to. It waits for EVERY check to finish
 * before calling it failed, so the fix addresses all of the failures at once and
 * is not pushed while other checks are still running (a push cancels them).
 * No checks at all is `none`: the caller decides whether that is "not
 * registered yet" or "this repo has no CI".
 */
export function evaluateChecks(runs: readonly CheckRun[]): ChecksVerdict {
  if (runs.length === 0) return { state: 'none' };
  const unfinished = runs.filter((run) => run.status !== 'completed');
  if (unfinished.length > 0) {
    return { state: 'pending', pending: unfinished.map((run) => run.name) };
  }
  const failed = runs.filter(
    (run) => !PASSING_CONCLUSIONS.has(run.conclusion ?? ''),
  );
  return failed.length > 0
    ? { state: 'failed', failed }
    : { state: 'green', count: runs.length };
}

/** Clips model text that is about to be stored or posted. */
export function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/**
 * Whether the dbt agent may start, given what became of the PostHog agent's
 * pull request.
 *
 * - The PostHog agent is still working: wait, its answer is not in yet.
 * - It opened a PR that is still open: wait. dbt must follow what shipped.
 * - The PR was merged: go, and take its events into account.
 * - The PR was closed without merging: go, WITHOUT those events.
 * - It opened no PR (nothing needed, or it failed): go.
 */
export type DbtGate =
  | { open: false; reason: string }
  | { open: true; withEvents: boolean; note: string | null };

export function evaluateDbtGate(
  posthog: Pick<
    AnalyticsAutomationAgentRun,
    'status' | 'prNumber' | 'prState'
  > | null,
): DbtGate {
  if (!posthog || posthog.status === 'running') {
    return {
      open: false,
      reason: 'Waiting for the PostHog events agent to finish.',
    };
  }
  if (posthog.prNumber === null) {
    return {
      open: true,
      withEvents: false,
      note:
        posthog.status === 'failed'
          ? 'The PostHog events agent failed, so no new events were considered.'
          : null,
    };
  }
  const state: AnalyticsAutomationPrState | null = posthog.prState;
  if (state === 'merged') return { open: true, withEvents: true, note: null };
  if (state === 'closed') {
    return {
      open: true,
      withEvents: false,
      note: 'The PostHog events pull request was closed without merging, so its events were left out.',
    };
  }
  return {
    open: false,
    reason:
      'Waiting for the PostHog events pull request to be merged or closed.',
  };
}
