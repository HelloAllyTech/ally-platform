/**
 * Roadmap v2 P8: `GET /v1/roadmap/metrics` (Owner only), mirrored from ally-be's
 * `src/product-roadmap/metrics/roadmap-metrics.util.ts`. Durations are in ms; null means nothing
 * to measure in the range.
 */
export interface RoadmapDurationStats {
  n: number;
  medianMs: number | null;
  p75Ms: number | null;
}

export type RoadmapStageKey =
  | "submitted_accepted"
  | "accepted_planning"
  | "planning_building"
  | "building_shipped";

export interface RoadmapServiceCount {
  service: string;
  count: number;
}

export interface RoadmapIdeaSpend {
  code: string | null;
  /** Null for a private draft: listed by code only. */
  title: string | null;
  totalUsd: number;
  approximate: boolean;
}

/** The waits after review (idea-to-plan audit rec 9). Absent from an older server. */
export interface RoadmapPlanWaits {
  acceptedUnplannedNow: number;
  planningNow: number;
  submittedToPlanning: RoadmapDurationStats;
  planningToClosed: RoadmapDurationStats;
  /** Plans closed in the range (planned by someone else than the author), and how many authors looked first. */
  authorLooked: { closed: number; opened: number };
}

export interface RoadmapMetrics {
  range: { from: string; to: string };
  generatedAt: string;
  /** A cohort: ideas captured in the range, and how far each has got. */
  funnel: {
    captured: number;
    submitted: number;
    accepted: number;
    shipped: number;
    measured: number;
    filedWithoutDraft: number;
  };
  /** Moves out of each stage that finished in the range. */
  stages: ({ key: RoadmapStageKey } & RoadmapDurationStats)[];
  reviewWait: RoadmapDurationStats & {
    waitingNow: number;
    overAmberNow: number;
    amberDays: number;
    longestWaitingMs: number | null;
  };
  idleLeadReleases: number | null;
  releases: {
    held: { total: number; shadow: number; byService: RoadmapServiceCount[] };
    failed: { total: number; byService: RoadmapServiceCount[] };
    failingIdeasNow: number;
  };
  spend: {
    ideas: number;
    totalUsd: number;
    medianUsd: number | null;
    p75Usd: number | null;
    approximate: boolean;
    top: RoadmapIdeaSpend[];
  };
  waits?: RoadmapPlanWaits;
}

export interface RoadmapMetricsQuery {
  /** ISO date, inclusive. */
  from: string;
  /** ISO date; a date alone includes that whole day. */
  to: string;
}
