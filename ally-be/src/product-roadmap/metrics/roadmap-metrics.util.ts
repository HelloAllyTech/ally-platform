/**
 * Roadmap v2 P8 (Measure): the funnel, stage times, review wait, releases and
 * spend the Owner's Measures view shows (plans/roadmap-builder-merge §7, P8).
 *
 * Pure: the service loads rows from the existing tables and hands them here,
 * so every rule about what counts lives in one tested place. Nothing here
 * reads a transcript, a decline reason or a draft's words.
 *
 * Two kinds of window, on purpose:
 * - The FUNNEL is a cohort: ideas captured (drafts created) in the range, and
 *   how far each has got by now. Counting each step's events in the range
 *   instead would mix different ideas at each step and could show more
 *   accepted than submitted; a cohort shows the real drop-off between steps
 *   [FP-2613].
 * - STAGE TIMES and the REVIEW WAIT count moves that finished in the range,
 *   whenever they started: "how long did the moves we saw this month take".
 *
 * Durations are medians and 75th percentiles, never means: one idea parked for
 * a quarter would otherwise swamp a month of quick ones.
 */

export const DAY_MS = 86_400_000;

/** The Measures view's default window. */
export const METRICS_DEFAULT_DAYS = 30;
/** The widest window the route answers, so one request stays cheap. */
export const METRICS_MAX_DAYS = 731;
/** How many ideas the spend table lists. */
export const METRICS_TOP_SPEND = 5;

/** What one idea's life looks like, as timestamps. Null means "not yet" or "not known". */
export interface IdeaTimeline {
  /** The draft was created (its plan session). Null for an idea filed with no draft. */
  capturedAt: Date | null;
  /** It reached the board (the opportunity row). Null while a private draft. */
  submittedAt: Date | null;
  /** The Owner's review; null for a row nobody reviewed through Roadmap v2. */
  reviewState: 'pending' | 'accepted' | 'declined' | null;
  reviewedAt: Date | null;
  /** Start planning was pressed, or the brief went to Claude Code. */
  planningAt: Date | null;
  /** A build ran here, or a pull request exists after the brief was sent. */
  buildingAt: Date | null;
  shippedAt: Date | null;
  /** The first outcome review with a verdict (hit, partial or miss). */
  measuredAt: Date | null;
  /** Archived, or closed as not pursuing: no longer waiting for anything. */
  closed: boolean;
  /** An Owner closed the plan (the first time). Absent on a row read before it was tracked. */
  planClosedAt?: Date | null;
  /** The author first opened the idea while it was being planned. */
  authorOpenedPlanAt?: Date | null;
  /** The author is the person who started planning (their own look says nothing). */
  plannedByAuthor?: boolean;
}

export interface DurationStats {
  /** How many durations the figures are over. */
  n: number;
  medianMs: number | null;
  p75Ms: number | null;
}

export type StageKey =
  | 'submitted_accepted'
  | 'accepted_planning'
  | 'planning_building'
  | 'building_shipped';

export const STAGE_KEYS: StageKey[] = [
  'submitted_accepted',
  'accepted_planning',
  'planning_building',
  'building_shipped',
];

export interface FunnelCounts {
  captured: number;
  submitted: number;
  accepted: number;
  shipped: number;
  measured: number;
  /**
   * Ideas that reached the board in the range without a draft (the legacy
   * filing path, consumer bug reports). Outside the cohort, shown beside it so
   * the funnel is not read as everything that was filed.
   */
  filedWithoutDraft: number;
}

export interface ReviewWait extends DurationStats {
  /** Ideas waiting for the Owner's review right now. */
  waitingNow: number;
  /** Of those, how many have waited more than `amberDays` working days. */
  overAmberNow: number;
  amberDays: number;
  /** The longest current wait, in ms; null when nothing is waiting. */
  longestWaitingMs: number | null;
}

export interface ServiceCount {
  service: string;
  count: number;
}

/** One row of P5's `release_policy_log` the metrics read. */
export interface PolicyLogRow {
  kind: string;
  mode: string | null;
  decision: string | null;
  outcome: string | null;
  healthy: boolean | null;
  service: string | null;
  at: Date;
}

export interface ReleaseMetrics {
  held: { total: number; shadow: number; byService: ServiceCount[] };
  failed: { total: number; byService: ServiceCount[] };
  /** Ideas whose newest release containing their work failed (P1), right now. */
  failingIdeasNow: number;
}

/** One idea's spend in the range, from the ledger. `title` is null for a private draft. */
export interface IdeaSpend {
  code: string | null;
  title: string | null;
  totalUsd: number;
  approximate: boolean;
}

export interface SpendMetrics {
  /** Ideas with any spend in the range. */
  ideas: number;
  totalUsd: number;
  medianUsd: number | null;
  p75Usd: number | null;
  /** Some calls had no price when made: totals are a floor. */
  approximate: boolean;
  top: IdeaSpend[];
}

/**
 * The waits after review (idea-to-plan audit rec 9): how many accepted ideas
 * nobody has started planning, how long from filing to Start planning, and
 * how long a plan takes to close. Plus rec 8's "worked if": of the plans
 * closed in the range (planned by someone other than the author), how many
 * authors opened the idea before it closed.
 */
export interface PlanWaits {
  /** Accepted (or never reviewed), still open, and nobody has pressed Start planning: right now. */
  acceptedUnplannedNow: number;
  /** Planning started and the plan not closed yet: right now. */
  planningNow: number;
  /** Filed → Start planning, over the starts in the range. */
  submittedToPlanning: DurationStats;
  /** Start planning → Close plan, over the closes in the range. */
  planningToClosed: DurationStats;
  authorLooked: { closed: number; opened: number };
}

export interface RoadmapMetrics {
  range: { from: string; to: string };
  generatedAt: string;
  funnel: FunnelCounts;
  stages: ({ key: StageKey } & DurationStats)[];
  reviewWait: ReviewWait;
  /**
   * Leads handed back automatically for idleness (`plan_events.auto_released`
   * with the idle note). Under D11 nothing releases a lead automatically, so
   * anything above 0 means the old sweep ran. Null when it cannot be read.
   */
  idleLeadReleases: number | null;
  releases: ReleaseMetrics;
  spend: SpendMetrics;
  /** Absent from a server older than idea-to-plan audit rec 9. */
  waits?: PlanWaits;
}

// ── range ─────────────────────────────────────────────────────────────────────

export type RangeResult =
  | { ok: true; from: Date; to: Date }
  | { ok: false; message: string };

const parseDate = (value: string | undefined): Date | null | 'invalid' => {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'invalid' : date;
};

/**
 * `from` inclusive, `to` exclusive. Missing `to` is now; missing `from` is 30
 * days before `to`. A date-only `to` ("2026-11-17") means the end of that day,
 * so a picked range includes its last day.
 */
export function resolveMetricsRange(
  input: { from?: string; to?: string },
  now: Date,
): RangeResult {
  const from = parseDate(input.from);
  let to = parseDate(input.to);
  if (from === 'invalid' || to === 'invalid') {
    return { ok: false, message: 'from and to must be dates.' };
  }
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(input.to ?? '')) {
    to = new Date(to.getTime() + DAY_MS);
  }
  const end = to ?? now;
  const start = from ?? new Date(end.getTime() - METRICS_DEFAULT_DAYS * DAY_MS);
  if (start.getTime() >= end.getTime()) {
    return { ok: false, message: 'from must be before to.' };
  }
  if (end.getTime() - start.getTime() > METRICS_MAX_DAYS * DAY_MS) {
    return {
      ok: false,
      message: `A range can be at most ${METRICS_MAX_DAYS} days.`,
    };
  }
  return { ok: true, from: start, to: end };
}

const inRange = (
  date: Date | null,
  range: { from: Date; to: Date },
): date is Date =>
  !!date &&
  date.getTime() >= range.from.getTime() &&
  date.getTime() < range.to.getTime();

// ── statistics ────────────────────────────────────────────────────────────────

/**
 * The q-th quantile (0..1) by linear interpolation between closest ranks,
 * the same as Postgres `percentile_cont`. Null for an empty list.
 */
export function quantile(values: readonly number[], q: number): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * Math.min(1, Math.max(0, q));
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export function durationStats(durations: readonly number[]): DurationStats {
  return {
    n: durations.length,
    medianMs: quantile(durations, 0.5),
    p75Ms: quantile(durations, 0.75),
  };
}

/**
 * Whole working days (Mon–Fri, UTC) from `since` to `now`: the same count the
 * triage row's amber age uses (§4.6). 0 for a future date.
 */
export function workingDaysBetween(since: Date, now: Date): number {
  if (since.getTime() >= now.getTime()) return 0;
  const day = new Date(
    Date.UTC(since.getUTCFullYear(), since.getUTCMonth(), since.getUTCDate()),
  );
  const last = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  let count = 0;
  while (day.getTime() < last) {
    day.setUTCDate(day.getUTCDate() + 1);
    const dow = day.getUTCDay();
    if (dow !== 0 && dow !== 6) count += 1;
  }
  return count;
}

// ── the parts ─────────────────────────────────────────────────────────────────

/** When it was accepted, if it was. A legacy row (no review) has no time to give. */
const acceptedAt = (t: IdeaTimeline): Date | null =>
  t.reviewState === 'accepted' ? t.reviewedAt : null;

/**
 * How far an idea has got: 0 captured · 1 submitted · 2 accepted · 3 shipped
 * · 4 measured. A later fact implies the earlier steps, so the funnel never
 * narrows the wrong way (a legacy row nobody reviewed reads as accepted, as
 * deriveItemStage reads it). A declined idea stops at submitted.
 */
export function furthestStep(t: IdeaTimeline): number {
  if (t.measuredAt) return 4;
  if (t.shippedAt) return 3;
  if (!t.submittedAt) return 0;
  if (t.reviewState === 'declined') return 1;
  if (
    t.reviewState === 'accepted' ||
    t.reviewState === null ||
    t.planningAt ||
    t.buildingAt
  ) {
    return 2;
  }
  return 1;
}

export function funnelFor(
  ideas: readonly IdeaTimeline[],
  range: { from: Date; to: Date },
): FunnelCounts {
  const counts: FunnelCounts = {
    captured: 0,
    submitted: 0,
    accepted: 0,
    shipped: 0,
    measured: 0,
    filedWithoutDraft: 0,
  };
  for (const idea of ideas) {
    if (!idea.capturedAt) {
      if (inRange(idea.submittedAt, range)) counts.filedWithoutDraft += 1;
      continue;
    }
    if (!inRange(idea.capturedAt, range)) continue;
    const step = furthestStep(idea);
    counts.captured += 1;
    if (step >= 1) counts.submitted += 1;
    if (step >= 2) counts.accepted += 1;
    if (step >= 3) counts.shipped += 1;
    if (step >= 4) counts.measured += 1;
  }
  return counts;
}

const STAGE_ENDS: Record<
  StageKey,
  (t: IdeaTimeline) => [Date | null, Date | null]
> = {
  submitted_accepted: (t) => [t.submittedAt, acceptedAt(t)],
  accepted_planning: (t) => [acceptedAt(t), t.planningAt],
  planning_building: (t) => [t.planningAt, t.buildingAt],
  building_shipped: (t) => [t.buildingAt, t.shippedAt],
};

/** Time in each stage, over the moves out of it that finished in the range. */
export function stageTimesFor(
  ideas: readonly IdeaTimeline[],
  range: { from: Date; to: Date },
): ({ key: StageKey } & DurationStats)[] {
  return STAGE_KEYS.map((key) => {
    const durations: number[] = [];
    for (const idea of ideas) {
      const [start, end] = STAGE_ENDS[key](idea);
      if (!start || !inRange(end, range)) continue;
      const ms = end.getTime() - start.getTime();
      // A clock skew or a backfilled timestamp is not a negative wait.
      if (ms >= 0) durations.push(ms);
    }
    return { key, ...durationStats(durations) };
  });
}

/**
 * The Owner-review wait (the D10/D11 bottleneck guard): reviews done in the
 * range, submitted → accepted or declined; and, right now, how many wait and
 * how many have waited past the amber line.
 */
export function reviewWaitFor(
  ideas: readonly IdeaTimeline[],
  range: { from: Date; to: Date },
  now: Date,
  amberDays: number,
): ReviewWait {
  const done: number[] = [];
  let waitingNow = 0;
  let overAmberNow = 0;
  let longest: number | null = null;
  for (const idea of ideas) {
    if (!idea.submittedAt) continue;
    if (
      (idea.reviewState === 'accepted' || idea.reviewState === 'declined') &&
      inRange(idea.reviewedAt, range)
    ) {
      const ms = idea.reviewedAt.getTime() - idea.submittedAt.getTime();
      if (ms >= 0) done.push(ms);
    }
    if (idea.reviewState === 'pending' && !idea.closed) {
      waitingNow += 1;
      if (workingDaysBetween(idea.submittedAt, now) > amberDays) {
        overAmberNow += 1;
      }
      const ms = Math.max(0, now.getTime() - idea.submittedAt.getTime());
      longest = longest === null ? ms : Math.max(longest, ms);
    }
  }
  return {
    ...durationStats(done),
    waitingNow,
    overAmberNow,
    amberDays,
    longestWaitingMs: longest,
  };
}

/** The waits between review and a closed plan (rec 9), and whether authors looked (rec 8). */
export function planWaitsFor(
  ideas: readonly IdeaTimeline[],
  range: { from: Date; to: Date },
): PlanWaits {
  let acceptedUnplannedNow = 0;
  let planningNow = 0;
  const toPlanning: number[] = [];
  const toClosed: number[] = [];
  const authorLooked = { closed: 0, opened: 0 };
  for (const idea of ideas) {
    if (!idea.submittedAt) continue;
    const moving = !!idea.buildingAt || !!idea.shippedAt;
    const accepted =
      idea.reviewState === 'accepted' || idea.reviewState === null;
    if (!idea.closed && !moving) {
      if (!idea.planningAt && accepted) acceptedUnplannedNow += 1;
      if (idea.planningAt && !idea.planClosedAt) planningNow += 1;
    }
    if (idea.planningAt && inRange(idea.planningAt, range)) {
      const ms = idea.planningAt.getTime() - idea.submittedAt.getTime();
      if (ms >= 0) toPlanning.push(ms);
    }
    if (
      idea.planningAt &&
      idea.planClosedAt &&
      inRange(idea.planClosedAt, range)
    ) {
      const ms = idea.planClosedAt.getTime() - idea.planningAt.getTime();
      if (ms >= 0) toClosed.push(ms);
      if (!idea.plannedByAuthor) {
        authorLooked.closed += 1;
        if (
          idea.authorOpenedPlanAt &&
          idea.authorOpenedPlanAt.getTime() <= idea.planClosedAt.getTime()
        ) {
          authorLooked.opened += 1;
        }
      }
    }
  }
  return {
    acceptedUnplannedNow,
    planningNow,
    submittedToPlanning: durationStats(toPlanning),
    planningToClosed: durationStats(toClosed),
    authorLooked,
  };
}

const byService = (rows: readonly PolicyLogRow[]): ServiceCount[] => {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = row.service ?? 'all';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([service, count]) => ({ service, count }))
    .sort((a, b) => b.count - a.count || a.service.localeCompare(b.service));
};

/**
 * Held: the policy's `held` decisions in the range (a decision row is written
 * only when the decision, its base or the service's head changes, so each row
 * is one held episode). Shadow ones are what the policy would have held.
 * Failed: production releases observed in the range that failed, or finished
 * but failed their health check.
 */
export function releasesFor(
  rows: readonly PolicyLogRow[],
  range: { from: Date; to: Date },
  failingIdeasNow: number,
): ReleaseMetrics {
  const inside = rows.filter((row) => inRange(row.at, range));
  const held = inside.filter(
    (row) => row.kind === 'decision' && row.decision === 'held',
  );
  const failed = inside.filter(
    (row) =>
      row.kind === 'observed_release' &&
      (row.outcome === 'failed' || row.healthy === false),
  );
  return {
    held: {
      total: held.length,
      shadow: held.filter((row) => row.mode === 'shadow').length,
      byService: byService(held),
    },
    failed: { total: failed.length, byService: byService(failed) },
    failingIdeasNow,
  };
}

const roundUsd = (value: number): number => Math.round(value * 100) / 100;

/** Spend per idea in the range: ideas with none are left out of the figures. */
export function spendFor(rows: readonly IdeaSpend[]): SpendMetrics {
  const spent = rows.filter((row) => row.totalUsd > 0);
  const totals = spent.map((row) => row.totalUsd);
  const median = quantile(totals, 0.5);
  const p75 = quantile(totals, 0.75);
  return {
    ideas: spent.length,
    totalUsd: roundUsd(totals.reduce((sum, value) => sum + value, 0)),
    medianUsd: median === null ? null : roundUsd(median),
    p75Usd: p75 === null ? null : roundUsd(p75),
    approximate: spent.some((row) => row.approximate),
    top: [...spent]
      .sort(
        (a, b) =>
          b.totalUsd - a.totalUsd || (a.code ?? '').localeCompare(b.code ?? ''),
      )
      .slice(0, METRICS_TOP_SPEND)
      .map((row) => ({ ...row, totalUsd: roundUsd(row.totalUsd) })),
  };
}

/** Everything the Measures view shows, from loaded rows. */
export function computeRoadmapMetrics(input: {
  range: { from: Date; to: Date };
  now: Date;
  amberDays: number;
  ideas: readonly IdeaTimeline[];
  policyLog: readonly PolicyLogRow[];
  failingIdeasNow: number;
  idleLeadReleases: number | null;
  spend: readonly IdeaSpend[];
}): RoadmapMetrics {
  const { range, now } = input;
  return {
    range: { from: range.from.toISOString(), to: range.to.toISOString() },
    generatedAt: now.toISOString(),
    funnel: funnelFor(input.ideas, range),
    stages: stageTimesFor(input.ideas, range),
    reviewWait: reviewWaitFor(input.ideas, range, now, input.amberDays),
    idleLeadReleases: input.idleLeadReleases,
    releases: releasesFor(input.policyLog, range, input.failingIdeasNow),
    spend: spendFor(input.spend),
    waits: planWaitsFor(input.ideas, range),
  };
}

/** The earliest of some dates; null when none is set. */
export function earliest(...dates: (Date | null | undefined)[]): Date | null {
  let best: Date | null = null;
  for (const date of dates) {
    if (!date || Number.isNaN(date.getTime())) continue;
    if (!best || date.getTime() < best.getTime()) best = date;
  }
  return best;
}

/** The later of two dates, or null unless both are set. */
export function bothThenLater(
  a: Date | null | undefined,
  b: Date | null | undefined,
): Date | null {
  if (!a || !b) return null;
  return a.getTime() >= b.getTime() ? a : b;
}
