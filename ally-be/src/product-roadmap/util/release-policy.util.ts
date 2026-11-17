import {
  CommitFiles,
  GraphCommit,
} from 'src/github/service/github-actions.service';
import {
  FrontendApp,
  FrontendApps,
  mergeFrontendApps,
  releaseServiceForPath,
} from 'src/release/constants/release-services.constants';

import {
  BACKEND_HEALTH_WAIT_MS,
  DEFAULT_AUTO_RELEASE_HELD_PATHS,
  RELEASE_DEBOUNCE_MS,
  RELEASE_POLICY_BACKENDS,
  PolicyServiceKey,
} from '../constants/release-policy.constants';
import {
  ReleasePolicyComparison,
  ReleasePolicyDecision,
} from '../enum/release-policy.enum';

/**
 * The deterministic half of the auto-release policy (Roadmap v2, P5; plan
 * §5.5): which commits a release would ship, whether any of them holds it,
 * and what the policy decides. No I/O, so every rule is testable on its own;
 * `ReleasePlanService` and `PolicyServiceKey` do the reading and writing.
 */

// ── Held paths ───────────────────────────────────────────────────────────────

/**
 * A held-path glob as a regular expression. `*` and `?` stay inside one
 * folder, `**` crosses any number, and the match is case-insensitive. A
 * pattern also matches everything under a path it matches, so naming a
 * folder holds its contents: `**` + `/*payment*` holds `src/payments/a.ts`.
 */
export function compileHeldPattern(glob: string): RegExp {
  const pattern = glob.trim().replace(/^\.?\/+/, '');
  let out = '';
  for (let i = 0; i < pattern.length; i += 1) {
    const char = pattern[i];
    if (char === '*' && pattern[i + 1] === '*') {
      const slashAfter = pattern[i + 2] === '/';
      const slashBefore = i === 0 || pattern[i - 1] === '/';
      if (slashBefore && slashAfter) {
        out += '(?:.*/)?';
        i += 2;
      } else if (slashBefore && i + 2 === pattern.length && i > 0) {
        // `folder/**` at the end: the folder itself or anything under it.
        out = out.replace(/\/$/, '');
        out += '(?:/.*)?';
        i += 1;
      } else {
        out += '.*';
        i += 1;
      }
    } else if (char === '*') {
      out += '[^/]*';
    } else if (char === '?') {
      out += '[^/]';
    } else {
      out += char.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }
  }
  return new RegExp(`^${out}(?:/.*)?$`, 'i');
}

/** The first held rule a path matches, or null. */
export function matchHeldRule(
  path: string,
  rules: readonly { rule: string; regex: RegExp }[],
): string | null {
  const clean = path.replace(/^\.?\/+/, '');
  return rules.find((entry) => entry.regex.test(clean))?.rule ?? null;
}

/** Rules ready to match: the Owner's list, or the defaults when it is empty. */
export function compileHeldRules(
  rules: readonly string[],
): { rule: string; regex: RegExp }[] {
  return rules.map((rule) => ({ rule, regex: compileHeldPattern(rule) }));
}

/**
 * The held-path setting as stored (P0's `autoReleaseHeldPaths`): a string
 * array, JSON text of one, or nothing. Anything unusable, or an empty list,
 * means the defaults: an Owner clearing the list must not silently switch
 * holding off.
 */
export function normaliseHeldPaths(raw: unknown): string[] {
  let value: unknown = raw;
  if (typeof raw === 'string') {
    try {
      value = JSON.parse(raw);
    } catch {
      value = raw
        .split(/[\n,]/)
        .map((line) => line.trim())
        .filter(Boolean);
    }
  }
  const list = Array.isArray(value)
    ? value
        .map((entry) =>
          typeof entry === 'string'
            ? entry
            : entry && typeof entry === 'object' && 'pattern' in entry
              ? String((entry as { pattern: unknown }).pattern)
              : '',
        )
        .map((entry) => entry.trim())
        .filter(Boolean)
    : [];
  return list.length ? list : [...DEFAULT_AUTO_RELEASE_HELD_PATHS];
}

// ── Release window ───────────────────────────────────────────────────────────

/**
 * When auto-release may run (P0's `releaseWindow`). Null is any time, the
 * default. `days` are 0 (Sunday) to 6; `start`/`end` are `HH:MM` in
 * `timeZone`; an `end` before `start` runs past midnight.
 */
export interface ReleaseWindow {
  days: number[] | null;
  start: string;
  end: string;
  timeZone: string;
}

const HH_MM = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const DEFAULT_WINDOW_TIME_ZONE = 'Asia/Kolkata';

/** The stored window, or null (any time) when it is absent or unreadable. */
export function normaliseReleaseWindow(raw: unknown): ReleaseWindow | null {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== 'object') return null;
  const input = value as Record<string, unknown>;
  // P0's settings DTO stores whole hours as { startHour, endHour, timezone };
  // read that shape too, so a window saved from Settings is never ignored.
  const hourToHhMm = (h: unknown): string =>
    typeof h === 'number' && Number.isInteger(h) && h >= 0 && h <= 23
      ? `${String(h).padStart(2, '0')}:00`
      : '';
  const start = String(input.start ?? hourToHhMm(input.startHour));
  const end = String(input.end ?? hourToHhMm(input.endHour));
  if (!HH_MM.test(start) || !HH_MM.test(end)) return null;
  const days = Array.isArray(input.days)
    ? input.days
        .map(Number)
        .filter((day) => Number.isInteger(day) && day >= 0 && day <= 6)
    : null;
  let timeZone =
    typeof input.timeZone === 'string' && input.timeZone
      ? input.timeZone
      : typeof input.timezone === 'string' && input.timezone
        ? input.timezone
        : DEFAULT_WINDOW_TIME_ZONE;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
  } catch {
    timeZone = DEFAULT_WINDOW_TIME_ZONE;
  }
  return { days: days?.length ? days : null, start, end, timeZone };
}

const minutesOf = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Whether `now` falls inside the window. No window is any time. */
export function withinReleaseWindow(
  now: Date,
  window: ReleaseWindow | null,
): boolean {
  if (!window) return true;
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: window.timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const part = (type: string) =>
    parts.find((entry) => entry.type === type)?.value ?? '';
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  const day = WEEKDAYS.indexOf(part('weekday'));
  const start = minutesOf(window.start);
  const end = minutesOf(window.end);

  if (start === end) return !window.days || window.days.includes(day);
  if (start < end) {
    return (
      minute >= start &&
      minute < end &&
      (!window.days || window.days.includes(day))
    );
  }
  // Past midnight: the late half belongs to today, the early half to the day before.
  if (minute >= start) return !window.days || window.days.includes(day);
  if (minute < end) return !window.days || window.days.includes((day + 6) % 7);
  return false;
}

// ── Commits → pull requests ──────────────────────────────────────────────────

/** `Merge pull request #281 from …`, or a squash title ending `(#286)`. */
export function prNumberFromMessage(message: string): number | null {
  const title = message.split('\n')[0] ?? '';
  const merge = /^Merge pull request #(\d+)\b/.exec(title);
  if (merge) return Number(merge[1]);
  const squash = /\(#(\d+)\)\s*$/.exec(title);
  return squash ? Number(squash[1]) : null;
}

/** Every in-range commit reachable from `start` (inclusive), following parents. */
function reachable(
  start: string,
  bySha: Map<string, GraphCommit>,
): Set<string> {
  const seen = new Set<string>();
  const stack = [start];
  while (stack.length) {
    const sha = stack.pop()!;
    if (seen.has(sha) || !bySha.has(sha)) continue;
    seen.add(sha);
    stack.push(...bySha.get(sha)!.parents);
  }
  return seen;
}

/**
 * Which pull request brought each commit of a range in.
 *
 * A pull request merged with a merge commit brings in what its second parent
 * reaches and its first parent does not: the branch's own commits, including
 * any "merge master into the branch" syncs. Merges are taken oldest first, so
 * a commit belongs to the first pull request that landed it. A squash merge is
 * one commit whose title names its pull request.
 */
export function pullRequestsOfRange(
  commits: readonly GraphCommit[],
): Map<string, number> {
  const bySha = new Map(commits.map((commit) => [commit.sha, commit]));
  const prOf = new Map<string, number>();
  for (const commit of commits) {
    const number = prNumberFromMessage(commit.message);
    if (number === null) continue;
    if (commit.parents.length < 2) {
      if (!prOf.has(commit.sha)) prOf.set(commit.sha, number);
      continue;
    }
    prOf.set(commit.sha, number);
    const mainline = reachable(commit.parents[0], bySha);
    for (const sha of reachable(commit.parents[1], bySha)) {
      if (!mainline.has(sha) && !prOf.has(sha)) prOf.set(sha, number);
    }
  }
  return prOf;
}

// ── Classifying a range ──────────────────────────────────────────────────────

/** One commit a release would ship, as the plan and the log list it. */
export interface PlanCommit {
  sha: string;
  title: string;
  authorLogin: string | null;
  committedAt: string;
  prNumber: number | null;
  /** The merge commit of a pull request; its changes are the branch commits beside it. */
  merge: boolean;
  /** One of its files matched a held path. */
  held: boolean;
}

/** Why a release is held: which file of which commit matched which rule. */
export interface HeldReason {
  sha: string;
  file: string;
  rule: string;
}

/** A rule name for a commit whose files GitHub would not list in full. */
export const UNREADABLE_COMMIT_RULE = '(more than 300 files: not classifiable)';
/** A rule name for a range GitHub would not list in full. */
export const UNREADABLE_RANGE_RULE =
  '(more than 250 commits: not classifiable)';

/** One service's share of a commit range. */
export interface RangeClassification {
  commits: PlanCommit[];
  heldReasons: HeldReason[];
  /** Which dashboards the frontend range ships in; null for a backend. */
  apps: FrontendApps | null;
  prNumbers: number[];
  /** When the last commit of this service's share landed (a merge commit's date is the merge). */
  lastChangeAt: Date | null;
  /** The newest commit of this service's share. */
  serviceHeadSha: string | null;
  /** Set when a commit's files could not be read; nothing is decided on partial data. */
  unknown: string | null;
}

/**
 * The part of `base...master` a service's release would ship, and whether it
 * is held.
 *
 * A production release ships master's HEAD for its service: everyone's merged
 * work, not one idea's pull request. So every commit in the range is
 * classified, and **any** commit touching a held path inside the service's
 * folder holds the whole release (§5.5.1). A held path in another service's
 * folder does not hold this one: it does not ship here.
 *
 * Merge commits carry no files of their own here (their changes are their
 * branch commits, which the range also lists); a pull request's merge commit
 * is listed with the service's commits when any of its branch commits is.
 */
export function classifyRange(params: {
  service: PolicyServiceKey;
  /** For the frontend: classify for one dashboard (its own app or shared code). */
  app?: FrontendApp;
  commits: readonly GraphCommit[];
  /** A commit's files; undefined when it could not be read. */
  filesOf: (sha: string) => CommitFiles | undefined;
  rules: readonly { rule: string; regex: RegExp }[];
  /** GitHub listed fewer commits than the range holds. */
  rangeTruncated: boolean;
}): RangeClassification {
  const { service, app, commits, filesOf, rules } = params;
  const prOf = pullRequestsOfRange(commits);
  const heldReasons: HeldReason[] = [];
  const included = new Map<string, PlanCommit>();
  const prsTouched = new Set<number>();
  let apps: FrontendApps | null = null;
  let unknown: string | null = null;

  const touches = (file: string): FrontendApps | 'yes' | null => {
    const hit = releaseServiceForPath(file);
    if (!hit || hit.service !== service) return null;
    if (service !== 'frontend') return 'yes';
    if (app && hit.apps !== app && hit.apps !== 'both') return null;
    return hit.apps;
  };

  const plan = (commit: GraphCommit, held: boolean): PlanCommit => ({
    sha: commit.sha,
    title: (commit.message.split('\n')[0] ?? '').slice(0, 200),
    authorLogin: commit.authorLogin,
    committedAt: commit.committedAt.toISOString(),
    prNumber: prOf.get(commit.sha) ?? null,
    merge: commit.parents.length > 1,
    held,
  });

  for (const commit of commits) {
    if (commit.parents.length > 1) continue;
    const listing = filesOf(commit.sha);
    if (!listing) {
      unknown ??= `could not read the files of ${commit.sha.slice(0, 7)}`;
      continue;
    }
    if (listing.truncated) {
      // Too big to attribute: it may touch this service, so it holds it.
      heldReasons.push({
        sha: commit.sha,
        file: '*',
        rule: UNREADABLE_COMMIT_RULE,
      });
      included.set(commit.sha, plan(commit, true));
      if (service === 'frontend') apps = mergeFrontendApps(apps, app ?? 'both');
      continue;
    }
    let ownFiles = 0;
    let held = false;
    for (const file of listing.files) {
      const hit = touches(file);
      if (!hit) continue;
      ownFiles += 1;
      if (service === 'frontend' && hit !== 'yes')
        apps = mergeFrontendApps(apps, hit);
      const rule = matchHeldRule(file, rules);
      if (rule) {
        held = true;
        heldReasons.push({ sha: commit.sha, file, rule });
      }
    }
    if (!ownFiles) continue;
    included.set(commit.sha, plan(commit, held));
    const pr = prOf.get(commit.sha);
    if (pr !== undefined) prsTouched.add(pr);
  }

  // A pull request's merge commit joins the list when its branch touched the service.
  for (const commit of commits) {
    if (commit.parents.length < 2) continue;
    const pr = prOf.get(commit.sha);
    if (pr !== undefined && prsTouched.has(pr)) {
      included.set(commit.sha, plan(commit, false));
    }
  }

  if (params.rangeTruncated) {
    heldReasons.push({ sha: '', file: '*', rule: UNREADABLE_RANGE_RULE });
  }

  // Back in range order (oldest first), which is the order GitHub listed.
  const ordered = commits
    .filter((commit) => included.has(commit.sha))
    .map((commit) => included.get(commit.sha)!);
  const last = ordered[ordered.length - 1] ?? null;
  const lastChangeAt = ordered.reduce<Date | null>((latest, commit) => {
    const at = new Date(commit.committedAt);
    return !latest || at > latest ? at : latest;
  }, null);

  return {
    commits: ordered,
    heldReasons,
    apps: service === 'frontend' ? apps : null,
    prNumbers: [
      ...new Set(
        ordered
          .map((commit) => commit.prNumber)
          .filter((pr): pr is number => pr !== null),
      ),
    ].sort((a, b) => a - b),
    lastChangeAt,
    serviceHeadSha: last?.sha ?? null,
    unknown,
  };
}

/**
 * The frontend's two dashboards have separate release heads (one workflow,
 * an `apps` input), so each is classified against its own base and the
 * results combined: the release ships whichever app has changes, and either
 * app's held commit holds it.
 */
export function mergeRangeClassifications(
  a: RangeClassification,
  b: RangeClassification,
): RangeClassification {
  const bySha = new Map<string, PlanCommit>();
  for (const commit of [...a.commits, ...b.commits]) {
    const seen = bySha.get(commit.sha);
    bySha.set(
      commit.sha,
      seen ? { ...seen, held: seen.held || commit.held } : commit,
    );
  }
  const commits = [...bySha.values()].sort(
    (x, y) =>
      new Date(x.committedAt).getTime() - new Date(y.committedAt).getTime(),
  );
  const reasons = new Map<string, HeldReason>();
  for (const reason of [...a.heldReasons, ...b.heldReasons]) {
    reasons.set(`${reason.sha}|${reason.file}|${reason.rule}`, reason);
  }
  const later = (x: Date | null, y: Date | null) =>
    !x ? y : !y ? x : x > y ? x : y;
  const newer =
    !a.lastChangeAt || (b.lastChangeAt && b.lastChangeAt > a.lastChangeAt)
      ? b
      : a;
  return {
    commits,
    heldReasons: [...reasons.values()],
    apps: mergeFrontendApps(a.apps, b.apps),
    prNumbers: [...new Set([...a.prNumbers, ...b.prNumbers])].sort(
      (x, y) => x - y,
    ),
    lastChangeAt: later(a.lastChangeAt, b.lastChangeAt),
    serviceHeadSha:
      newer.serviceHeadSha ?? a.serviceHeadSha ?? b.serviceHeadSha,
    unknown: a.unknown ?? b.unknown,
  };
}

// ── Deciding ─────────────────────────────────────────────────────────────────

/** Everything the policy knows about one service's next release. */
export interface ServiceReleasePlan extends RangeClassification {
  service: PolicyServiceKey;
  /** The newest successful production release (a tag, or its run's head commit). */
  baseRef: string | null;
  baseTag: string | null;
  /** The master commit this plan was computed against. */
  headSha: string | null;
  opportunityIds: string[];
}

export interface PolicyVerdict {
  decision: ReleasePolicyDecision;
  /** For the shadow log and the app log; the UI renders its own words. */
  reason: string | null;
  /** When a debouncing service becomes releasable. */
  readyAt: Date | null;
}

/**
 * The policy's decision for every service, backends first (§5.5.2–5.5.4).
 *
 * Per service, the first that applies: the range could not be read
 * (`unknown`); nothing to release; a held path (`held`, which waits for a
 * Release click whatever else is true); the breaker is open (`paused`); fewer
 * than ten minutes since the last merge (`debouncing`); outside the release
 * window. Then the order rule: the frontend waits while any backend has
 * unreleased work or a release that has not yet answered its health check,
 * so a dashboard never ships ahead of the API it reads.
 */
export function decideReleases(input: {
  plans: ReadonlyMap<PolicyServiceKey, ServiceReleasePlan>;
  now: Date;
  pausedAt: Date | null;
  window: ReleaseWindow | null;
  /** Backends released recently whose health check has not passed yet. */
  unverifiedBackends: readonly PolicyServiceKey[];
}): Map<PolicyServiceKey, PolicyVerdict> {
  const verdicts = new Map<PolicyServiceKey, PolicyVerdict>();
  const verdict = (
    decision: ReleasePolicyDecision,
    reason: string | null = null,
    readyAt: Date | null = null,
  ): PolicyVerdict => ({ decision, reason, readyAt });

  const ownVerdict = (plan: ServiceReleasePlan): PolicyVerdict | null => {
    if (plan.unknown)
      return verdict(ReleasePolicyDecision.UNKNOWN, plan.unknown);
    if (!plan.commits.length) return verdict(ReleasePolicyDecision.NOTHING);
    if (plan.heldReasons.length) {
      const rules = [...new Set(plan.heldReasons.map((reason) => reason.rule))];
      return verdict(ReleasePolicyDecision.HELD, `touches ${rules.join(', ')}`);
    }
    if (input.pausedAt) {
      return verdict(
        ReleasePolicyDecision.PAUSED,
        `circuit breaker open since ${input.pausedAt.toISOString()}`,
      );
    }
    if (plan.lastChangeAt) {
      const readyAt = new Date(
        plan.lastChangeAt.getTime() + RELEASE_DEBOUNCE_MS,
      );
      if (readyAt > input.now) {
        return verdict(
          ReleasePolicyDecision.DEBOUNCING,
          `last merge ${plan.lastChangeAt.toISOString()}`,
          readyAt,
        );
      }
    }
    if (!withinReleaseWindow(input.now, input.window)) {
      return verdict(ReleasePolicyDecision.OUTSIDE_WINDOW);
    }
    return null;
  };

  for (const service of RELEASE_POLICY_BACKENDS) {
    const plan = input.plans.get(service);
    if (!plan) continue;
    verdicts.set(
      service,
      ownVerdict(plan) ?? verdict(ReleasePolicyDecision.RELEASE),
    );
  }

  const frontend = input.plans.get('frontend');
  if (frontend) {
    const own = ownVerdict(frontend);
    if (own) {
      verdicts.set('frontend', own);
    } else {
      const waitingOn = RELEASE_POLICY_BACKENDS.filter((service) => {
        const backend = verdicts.get(service);
        return (
          (backend && backend.decision !== ReleasePolicyDecision.NOTHING) ||
          // A backend whose plan could not be built at all is unknown, not "nothing".
          (!backend && !input.plans.has(service)) ||
          input.unverifiedBackends.includes(service)
        );
      });
      verdicts.set(
        'frontend',
        waitingOn.length
          ? verdict(
              ReleasePolicyDecision.WAITING_BACKEND,
              `waiting for ${waitingOn.join(', ')}`,
            )
          : verdict(ReleasePolicyDecision.RELEASE),
      );
    }
  }
  return verdicts;
}

// ── Health and the circuit breaker ───────────────────────────────────────────

/** One release's outcome, as the breaker reads it. */
export interface ReleaseOutcomeLike {
  succeeded: boolean;
  /** Null: not checked yet, or no health URL for the service. */
  healthy: boolean | null;
}

/**
 * Consecutive failed or unhealthy releases, newest first, until the first good
 * one. A release still waiting on its health check neither breaks the streak
 * nor adds to it: the next pass reads it again once it has an answer.
 */
export function consecutiveFailures(
  outcomesNewestFirst: readonly ReleaseOutcomeLike[],
): number {
  let failures = 0;
  for (const outcome of outcomesNewestFirst) {
    if (!outcome.succeeded || outcome.healthy === false) {
      failures += 1;
      continue;
    }
    if (outcome.healthy === null) continue;
    break;
  }
  return failures;
}

/**
 * Backends whose last release is too recent to trust: it succeeded inside the
 * wait window and has not answered healthy (still unchecked, or failed).
 */
export function unverifiedBackends(
  releases: readonly {
    service: string;
    succeeded: boolean;
    healthy: boolean | null;
    finishedAt: Date;
  }[],
  now: Date,
): PolicyServiceKey[] {
  const out = new Set<PolicyServiceKey>();
  for (const release of releases) {
    if (
      !(RELEASE_POLICY_BACKENDS as readonly string[]).includes(release.service)
    )
      continue;
    if (!release.succeeded) continue;
    if (now.getTime() - release.finishedAt.getTime() > BACKEND_HEALTH_WAIT_MS)
      continue;
    if (release.healthy !== true) out.add(release.service as PolicyServiceKey);
  }
  return [...out];
}

// ── The cutover check ────────────────────────────────────────────────────────

/**
 * How an observed release compares with the policy's last decision for its
 * service, when the answer follows from the decision alone. `release` needs
 * the commits compared too (`match` or `different_head`), so it returns null
 * and the caller decides.
 */
export function comparisonFromDecision(
  decision: ReleasePolicyDecision | null,
): ReleasePolicyComparison | null {
  if (!decision) return ReleasePolicyComparison.NO_DECISION;
  if (decision === ReleasePolicyDecision.RELEASE) return null;
  const byDecision: Record<string, ReleasePolicyComparison> = {
    [ReleasePolicyDecision.HELD]: ReleasePolicyComparison.POLICY_HELD,
    [ReleasePolicyDecision.PAUSED]: ReleasePolicyComparison.POLICY_PAUSED,
    [ReleasePolicyDecision.DEBOUNCING]:
      ReleasePolicyComparison.POLICY_DEBOUNCING,
    [ReleasePolicyDecision.OUTSIDE_WINDOW]:
      ReleasePolicyComparison.POLICY_OUTSIDE_WINDOW,
    [ReleasePolicyDecision.WAITING_BACKEND]:
      ReleasePolicyComparison.POLICY_WAITING_BACKEND,
    [ReleasePolicyDecision.NOTHING]: ReleasePolicyComparison.POLICY_NOTHING,
    [ReleasePolicyDecision.UNKNOWN]: ReleasePolicyComparison.POLICY_UNKNOWN,
  };
  return byDecision[decision] ?? ReleasePolicyComparison.NO_DECISION;
}
