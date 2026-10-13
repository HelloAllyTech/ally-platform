import { BugFinding, BugFindingStatus } from "@types";

/**
 * The seventeen `BugFindingStatus` values, collapsed into the five tabs above
 * the bugs table.
 *
 * Seventeen statuses is the right resolution for the backend's transition map
 * and the wrong resolution for a list somebody works through. These groups
 * encode, once and here, which statuses mean "you", which mean "it went red",
 * which mean "Bug Hunter has it", which mean "nobody has started", and which
 * mean "over".
 *
 * ## Why five tabs and not seven chips (2026-10-13)
 *
 * The page used to show seven chips plus "Everything", split by whose move it
 * is *and* by how far along the pipeline a bug was — "In review" apart from
 * "In progress", "Live" apart from "Closed". The product head's review found
 * that eight equally-weighted chips told a reader nothing about where to look,
 * and that the default ("Everything") put 456 closed rows in front of 44 open
 * ones. The five tabs answer one question each, in the order a reader asks
 * them: what needs me, what broke, what is moving, what is waiting, what is
 * finished.
 *
 * A PR waiting for review sits under **In progress** rather than its own tab:
 * it is still Bug Hunter's case, and the row's own Merge button is how a human
 * step on it is offered. MERGED moved to **Done**: the fix is on master, and
 * the drawer's Release button is where shipping it is decided.
 *
 * Releasable merged fixes are deliberately *not* under Needs you. Whether a
 * merge can be released is decided per bug by the backend (repo-to-app mapping,
 * credentials) and only the detail endpoint reports it; on prod on 2026-10-13
 * six of eighty-eight merged fixes were releasable. Putting every MERGED row in
 * Needs you would have buried the three real questions under eighty-two rows
 * with no button. `bucketOf` is the one place that changes if the list payload
 * ever carries `releasable`.
 *
 * ## This module owns the status groups for the whole page
 *
 * `agentPersona.ts`, the table, its filters and the triage rules all read the
 * groups from here. Two copies of "which statuses mean waiting on a human" is
 * how a header sentence and a tab count end up disagreeing about the same
 * number in the same render.
 *
 * Deliberately imports `@types` and nothing else — no `@constants`, so there
 * are no user-facing strings here at all. A module that page components import
 * must not read `@constants` at module-eval time (see the ally-web CLAUDE.md
 * gotcha). The tab labels live in `FindingsTabs`, which is a component.
 */
export type LifecycleBucket =
  /** A decision is blocked on a human. Nothing moves until someone clicks. */
  | "needs_you"
  /** Its last job went red. A human decides whether to try again. */
  | "failed"
  /** Bug Hunter has it: queued, fixing, releasing, or a PR open for review. */
  | "in_progress"
  /** Recorded, nobody is blocked, and it hasn't been started. */
  | "backlog"
  /** Over: merged, live, or closed without a fix. */
  | "done";

/**
 * Tab order, and the order the Status column sorts in.
 *
 * Front-loaded by whose move it is: a human's own unfinished work first, then
 * the agent's, then the queue nobody has started, then history.
 */
export const LIFECYCLE_BUCKETS: LifecycleBucket[] = [
  "needs_you",
  "failed",
  "in_progress",
  "backlog",
  "done",
];

/** Findings that have stopped and are waiting on a person. */
export const WAITING_ON_YOU_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.PENDING_APPROVAL,
  BugFindingStatus.NEEDS_INPUT,
];

/** Findings whose last job went red. */
export const PROBLEM_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.FAILED,
  BugFindingStatus.RELEASE_FAILED,
];

/**
 * Findings Bug Hunter is moving this minute — what the spinner and "fixing N
 * now" mean.
 *
 * Narrower than the In progress tab on purpose: a PR open for review is in that
 * tab, but nothing is running on it, and a spinner beside it would claim work
 * that isn't happening.
 */
export const IN_FLIGHT_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.QUEUED,
  BugFindingStatus.FIXING,
  BugFindingStatus.COORDINATING,
  BugFindingStatus.RELEASING,
];

/**
 * Which tab a status belongs to.
 *
 * Written as an exhaustive `switch` on purpose rather than as a lookup built
 * from arrays: `noFallthroughCasesInSwitch` plus the implicit `never` return
 * makes adding an eighteenth status a compile error here, which is the one
 * place a new status has to be classified.
 *
 * BLOCKED is backlog rather than needs-you despite naming a real wait: what it
 * waits on is an earlier repo in its own multi-repo plan, which is Bug Hunter's
 * problem and not a human's. CANCELLED is done rather than failed: a human
 * stopped it on purpose, and the drawer still offers a retry.
 */
export const bucketOfStatus = (status: BugFindingStatus): LifecycleBucket => {
  switch (status) {
    case BugFindingStatus.PENDING_APPROVAL:
    case BugFindingStatus.NEEDS_INPUT:
      return "needs_you";

    case BugFindingStatus.FAILED:
    case BugFindingStatus.RELEASE_FAILED:
      return "failed";

    case BugFindingStatus.QUEUED:
    case BugFindingStatus.FIXING:
    case BugFindingStatus.COORDINATING:
    case BugFindingStatus.RELEASING:
    case BugFindingStatus.PR_OPENED:
      return "in_progress";

    case BugFindingStatus.NEW:
    case BugFindingStatus.APPROVED:
    case BugFindingStatus.BLOCKED:
      return "backlog";

    case BugFindingStatus.MERGED:
    case BugFindingStatus.RELEASED:
    case BugFindingStatus.DISMISSED:
    case BugFindingStatus.REJECTED:
    case BugFindingStatus.CANCELLED:
      return "done";
  }
};

/**
 * Which tab a finding belongs to. Every row-level caller goes through this
 * rather than `bucketOfStatus`, so a rule that needs more than the status — a
 * releasable merge under Needs you, say — is one edit.
 */
export const bucketOf = (finding: BugFinding): LifecycleBucket => bucketOfStatus(finding.status);

/** Every status in a tab — what the tests assert against. */
export const statusesInBucket = (bucket: LifecycleBucket): BugFindingStatus[] =>
  Object.values(BugFindingStatus).filter(status => bucketOfStatus(status) === bucket);

/**
 * Old `?bucket=` values from the seven-chip row, and the tab each now lands
 * on, so a link pasted into chat before 2026-10-13 still opens on roughly what
 * it meant. `needs_you` kept its name and needs no entry. "In review" held PR
 * open and Merged; the open PR is the part still being reviewed.
 */
export const LEGACY_BUCKETS: Record<string, LifecycleBucket> = {
  problem: "failed",
  queued: "backlog",
  in_flight: "in_progress",
  in_review: "in_progress",
  shipped: "done",
  closed: "done",
};

/** Reads a `?bucket=` value, current or legacy. Anything else is no tab at all. */
export const parseBucket = (raw: string | null): LifecycleBucket | null => {
  if (!raw) return null;
  if ((LIFECYCLE_BUCKETS as string[]).includes(raw)) return raw as LifecycleBucket;
  return LEGACY_BUCKETS[raw] ?? null;
};

export type BucketCounts = Record<LifecycleBucket, number>;

/** Zeroed counts, so a caller can render a stable tab row before any data lands. */
export const emptyBucketCounts = (): BucketCounts =>
  LIFECYCLE_BUCKETS.reduce((counts, bucket) => {
    counts[bucket] = 0;
    return counts;
  }, {} as BucketCounts);

/**
 * How many findings sit in each tab. One pass, and every finding lands in
 * exactly one tab — so the counts sum to the list length.
 */
export const countByBucket = (findings: BugFinding[]): BucketCounts => {
  const counts = emptyBucketCounts();
  findings.forEach(finding => {
    counts[bucketOf(finding)] += 1;
  });
  return counts;
};

/**
 * The tab a reader lands on when the link doesn't name one.
 *
 * Needs you when it has anything in it, else In progress — never "everything",
 * which on prod opened on 456 closed rows to show 44 open ones.
 *
 * A sweep scope (`?run=`, from the shift log's "N found") is the exception: the
 * reader asked for one sweep's bugs, which usually sit in Backlog or Done, and
 * landing on an empty In progress beside a banner saying "10 found" reads as
 * the link having failed. So a scoped view opens on its first non-empty tab.
 */
export const defaultBucket = (
  counts: BucketCounts,
  { scoped = false }: { scoped?: boolean } = {},
): LifecycleBucket => {
  if (counts.needs_you > 0) return "needs_you";
  if (scoped) return LIFECYCLE_BUCKETS.find(bucket => counts[bucket] > 0) ?? "needs_you";
  return "in_progress";
};
