/**
 * Where a finding came from. `character varying` with a CHECK constraint, per
 * repo convention — not a Postgres enum.
 *
 * The first four are Bug Hunter's own finders (see `.claude/workflows/bug-hunt.mjs`).
 * `REPORTED_BUG` additionally exists from the moment a human files a roadmap
 * item of type `bug` — see RoadmapOpportunityService.create — independently of
 * whether any hunt run has looked at it yet. `ANALYTICS_SUGGESTION` exists only
 * on rows backfilled from the old Analytics → Suggestions bug queue (migration
 * 1898000000000); no code path writes it going forward.
 *
 * `UX_SIGNAL` is written by the UX Signals scan (src/ux-signals), which reads
 * PostHog telemetry rather than the codebase. Those findings carry no `file`:
 * their stable coordinate is a route/element, passed as `symbol` so they dedupe
 * precisely instead of falling back to the description fingerprint.
 *
 * `LOCALE_PARITY` is written by the sweep workflow itself, not by a model:
 * `scripts/i18n-parity.mjs` (ally-web, ally-mobile) compares every locale
 * file with en.json and posts one proven finding per file out of parity,
 * keyed on the file plus the constant symbol `locale-parity` (OPP-0782).
 */
export enum BugFindingSource {
  TEST_FAILURE = 'test_failure',
  LINT_ERROR = 'lint_error',
  CODE_REVIEW = 'code_review',
  PRODUCTION_LOG = 'production_log',
  REPORTED_BUG = 'reported_bug',
  ANALYTICS_SUGGESTION = 'analytics_suggestion',
  UX_SIGNAL = 'ux_signal',
  LOCALE_PARITY = 'locale_parity',
}

export enum BugFindingSeverity {
  LOW = 'low',
  MEDIUM = 'medium',
  HIGH = 'high',
}

/**
 * Why a bug was declined — by a human rejecting it, or by the Verify phase
 * refuting it.
 *
 * ## Why this is a closed list and not free text
 *
 * The reason has two readers, and only one of them is a person. The other is
 * the next sweep: `buildSweepPrompt` embeds recent declines as "known
 * non-bugs, do not re-file", and a prompt is only improved by a reason that
 * generalises. "not_a_bug" tells the finder its judgement was wrong;
 * "wont_fix" tells it the judgement was right and the priority was not, which
 * is not a finder problem at all. A free-text box collapses that distinction
 * into prose nobody can count, which is how the tab ended up unable to answer
 * "how often is this thing right?" — see BugHunterMetricsService.
 *
 * The optional free-text note still exists alongside it (`decision_note`), for
 * the half of the explanation a taxonomy cannot carry.
 *
 * `character varying` with a CHECK constraint, per repo convention — see
 * migration 1951000000000.
 */
export enum BugFindingDecisionReason {
  /** The finder was wrong: reading the code, this is not a defect. The only reason that counts against precision. */
  NOT_A_BUG = 'not_a_bug',
  /** Real, but already tracked elsewhere — another finding, an existing ticket, a known issue. */
  DUPLICATE = 'duplicate',
  /** Real, but the finder attributed it to the wrong codebase. */
  WRONG_REPO = 'wrong_repo',
  /** Real and correctly described, but not worth fixing. A priority call, not a finder error. */
  WONT_FIX = 'wont_fix',
  /** Real, but the fix is riskier than the bug — a human will handle it deliberately. */
  TOO_RISKY = 'too_risky',
  /** Anything the list above does not cover. Pair it with a note. */
  OTHER = 'other',
}

/**
 * Where a finding sits in the find → (approve) → fix → land pipeline.
 *
 * Transitions:
 *   NEW → PENDING_APPROVAL   (Manual mode only: verify confirmed it, discovery
 *                              itself never gates on mode)
 *   NEW → FIXING              (AI mode: verify-confirmed findings skip approval)
 *   NEW → DISMISSED            (verify refuted it)
 *   PENDING_APPROVAL → APPROVED | REJECTED   (admin decision)
 *   APPROVED → FIXING          (a later run's Fix phase picks it up)
 *   FIXING → NEEDS_INPUT       (fix agent hit a genuine open product question)
 *   NEEDS_INPUT → FIXING       (an admin answered; the pipeline resumed)
 *   FIXING → PR_OPENED | MERGED | DISMISSED | FAILED
 *
 * Plus the on-demand fix-session path (BugFixSessionService), which an admin
 * drives one bug at a time from the drawer:
 *
 *   NEW | PENDING_APPROVAL | APPROVED | PR_OPENED | FAILED | NEEDS_INPUT
 *      → QUEUED              (admin pressed "Start fix session"; GitHub
 *                              Actions dispatch accepted, workflow not yet in)
 *   QUEUED → FIXING           (the dispatched workflow reported in)
 *   QUEUED | FIXING → CANCELLED   (admin pressed "Stop fix session" — see
 *                                   BugFixSessionService.cancelFixSession)
 *   PR_OPENED → CANCELLED     (a developer closed the PR on GitHub without
 *                              merging — reconciled by
 *                              BugFixSessionService.reconcilePrOpenedFindings)
 *   MERGED → RELEASING        (admin pressed "Release to production")
 *   RELEASING → RELEASED | RELEASE_FAILED   (reconciled from the GitHub run)
 *   MERGED | RELEASE_FAILED → RELEASED   (somebody released that deployable
 *                              from GitHub after the PR merged — reconciled by
 *                              BugFixSessionService.reconcileOutOfBandReleases)
 *
 * RELEASE_FAILED is deliberately distinct from FAILED: FAILED means the fix
 * agent gave up and nothing landed, whereas RELEASE_FAILED means the fix IS
 * merged to master and only the deploy went red — a completely different thing
 * for an admin to act on, and re-releasable once CI is green.
 *
 * CANCELLED is likewise deliberately distinct from FAILED: FAILED means the
 * agent itself gave up, CANCELLED means a human stopped it on purpose — the
 * manual kill switch for a session that is clearly stuck or looping, so it
 * stops burning tokens/compute for the rest of its 60-minute cap rather than
 * running to the timeout. Same retry story as FAILED — see
 * BUG_FINDING_FIX_SESSION_START_STATUSES.
 *
 * NEW is also the resting state for a human-reported bug from the moment it's
 * filed until a hunt run triages it — see the source doc above.
 */
export enum BugFindingStatus {
  NEW = 'new',
  PENDING_APPROVAL = 'pending_approval',
  APPROVED = 'approved',
  QUEUED = 'queued',
  FIXING = 'fixing',
  NEEDS_INPUT = 'needs_input',
  /** A child step whose turn hasn't come yet — an earlier repo in the plan has to land first. */
  BLOCKED = 'blocked',
  /** A parent whose plan is being worked through, one repo at a time. Never a leaf's status. */
  COORDINATING = 'coordinating',
  PR_OPENED = 'pr_opened',
  MERGED = 'merged',
  RELEASING = 'releasing',
  RELEASED = 'released',
  RELEASE_FAILED = 'release_failed',
  DISMISSED = 'dismissed',
  REJECTED = 'rejected',
  FAILED = 'failed',
  /** An admin stopped a running fix session. Distinct from FAILED: a human decision, not the agent giving up — see BugFixSessionService.cancelFixSession. */
  CANCELLED = 'cancelled',
}

/**
 * A parent's status is derived from its children, never set directly by a fix
 * agent — see BugFixSessionService.syncParent. These are the only values a
 * coordinated parent ever holds.
 */
export const BUG_FINDING_PARENT_STATUSES: BugFindingStatus[] = [
  BugFindingStatus.COORDINATING,
  BugFindingStatus.MERGED,
  BugFindingStatus.RELEASING,
  BugFindingStatus.RELEASED,
  BugFindingStatus.RELEASE_FAILED,
  BugFindingStatus.FAILED,
  BugFindingStatus.NEEDS_INPUT,
  // A parent takes this on when one of its steps is cancelled mid-plan — see
  // BugFixSessionService.haltPlan. A parent itself is never QUEUED/FIXING
  // (only a leaf step is), so it can only ever arrive here via a stuck child.
  BugFindingStatus.CANCELLED,
];

/** Statuses a client may filter the table by, plus the "show everything" option. */
export const BUG_FINDING_STATUS_FILTERS = [
  ...Object.values(BugFindingStatus),
  'all',
] as const;

export type BugFindingStatusFilter =
  (typeof BUG_FINDING_STATUS_FILTERS)[number];

/**
 * The kill switch's three positions, replacing the old plain boolean.
 *
 *   OFF    — every trigger refuses to run, exactly like `enabled=false` before.
 *   MANUAL — discovery (find + verify) still runs on every trigger; only the
 *            fix/PR/merge stage waits for an admin to approve each finding.
 *   AI     — today's original behaviour: verify-confirmed findings go straight
 *            to the fix stage with no approval gate.
 *
 * There is no separate "pause discovery" state in Manual mode — see
 * BugFindingStatus's doc. That was an explicit product decision, not an
 * oversight: a comprehensive bug table is only useful if it keeps finding
 * bugs regardless of who's allowed to fix them.
 */
export enum BugHunterMode {
  OFF = 'off',
  MANUAL = 'manual',
  AI = 'ai',
}
