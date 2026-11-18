/**
 * Roadmap v2's read model, as the P2 API contract defines it (plans/roadmap-builder-merge §5.2).
 * Every route lives under `/v1/roadmap` and answers 404 while `roadmap_v2` is off.
 *
 * Status parts and "why here" arrive as data; the frontend writes every word, so every surface
 * says the same thing in the same copy (§4.9).
 */

export type RoadmapRole = "none" | "viewer" | "idea" | "builder" | "owner";

export type RoadmapShownStage =
  | "draft"
  | "submitted"
  | "accepted"
  | "planning"
  | "building"
  | "shipped"
  | "declined"
  | "closed";

/** The stage in five words: what rows, filters and the tracker say. `shownStage` keeps the detail. */
export type RoadmapSimpleStage = "draft" | "backlog" | "being_built" | "shipped" | "declined";

export type RoadmapWatchLevel = "all" | "milestones" | "none";

export type RoadmapRelation = "author" | "lead" | "owner" | "builder" | "idea";

export interface RoadmapPersonRef {
  id: number;
  name: string;
  role: RoadmapRole;
  relation?: RoadmapRelation;
  /** P4: ideas this person filed that are Released (the chip's hover). */
  ideasShipped?: number;
}

export type RoadmapCapability =
  | "vote"
  | "comment"
  | "answer"
  /** P0 returns it; the contract's list omits it. Absent: follow `answer` (Viewers have neither). */
  | "watch"
  | "submit"
  | "review"
  | "pickLead"
  | "startPlanning"
  | "settleAnswer"
  | "approveDesign"
  | "startBuild"
  | "merge"
  | "release"
  | "raiseCeiling"
  | "close"
  | "configure"
  | "star"
  | "pinView"
  | "exportBrief"
  | "editTitle"
  | "editGoal"
  | "editSummary"
  | "editLead"
  | "editMonth";

/** What the caller may do. Partial because the server may add keys; a missing key means no. */
export type RoadmapCan = Partial<Record<RoadmapCapability, boolean>>;

/** ci state of one open pull request inside the status line. */
export type RoadmapCiState = "pending" | "passing" | "failing" | "unknown";

/**
 * The status line under the tracker, as `deriveItemStage` returns it (ally-be
 * product-planning/util/plan-stage.util.ts). Typed as the known union with a loose fallback: the
 * contract types it `Record<string, unknown>`, so the frontend reads it defensively.
 */
export type RoadmapStatusParts =
  | { stage: "draft"; checksMet: number; checksTotal: number }
  | { stage: "submitted"; since: string | null; votes: number }
  | { stage: "accepted"; leadUserId: number | null; needsLead: boolean; votes: number }
  | {
      stage: "planning";
      step: "prd" | "design" | "ready";
      leadUserId: number | null;
      prdPercent: number | null;
      openQuestions: number;
      designAwaitingApproval: boolean;
      /** P4: the brief went to Claude Code and no PR exists yet ("Brief sent … waiting for a PR"). */
      externalBuild?: { byUserId: number; at: string } | null;
    }
  | {
      stage: "building";
      where: "here" | "claude_code";
      leadUserId: number | null;
      externalBuild: { byUserId: number; at: string } | null;
      repos: string[];
      openPrs: { number: number; ci: RoadmapCiState }[];
      mergedPrs: number;
      waitingForPr: boolean;
      releasing: boolean;
      heldReason: string | null;
    }
  | {
      stage: "shipped";
      step: "launching" | "measuring" | "learned" | null;
      liveSince: string | null;
      outcomeReviewAt: string | null;
      outcome: { hitTarget: boolean | null } | null;
    }
  | { stage: "declined"; byUserId: number | null; at: string | null }
  | {
      stage: "closed";
      reason: "not_pursuing" | "archived";
      byUserId: number | null;
      at: string | null;
    };

export type RoadmapDecisionKind =
  | "approveDesign"
  | "merge"
  | "release"
  | "budget"
  | "settleAnswer"
  | "startBuild"
  /** A stopped build, or a PR handed to a person. */
  | "unblock";

/** Why a row is in a view. The frontend renders the copy. */
export type RoadmapWhyHere =
  | { kind: "agentQuestion"; phase: "idea" | "plan"; questionPreview: string; since?: string }
  | { kind: "mention"; by: RoadmapPersonRef; since?: string }
  | { kind: "decision"; decision: RoadmapDecisionKind; since?: string }
  | { kind: "awaitingReview"; since: string }
  | { kind: "needsLead"; since: string }
  | { kind: "reassign"; idleDays: number }
  | { kind: "progress" }
  | { kind: "shipped"; at: string };

export interface RoadmapItemRow {
  /** The opportunity uuid: what the existing vote endpoint (unchanged, D17) takes. */
  id: string;
  code: string;
  title: string;
  shownStage: RoadmapShownStage;
  /** Draft, Backlog, Being built, Shipped or Declined. */
  stage: RoadmapSimpleStage;
  statusParts: RoadmapStatusParts | Record<string, unknown>;
  author: RoadmapPersonRef;
  lead?: RoadmapPersonRef;
  votes: number;
  /** Queue position, 1-based, for every idea not yet released. Absent once released or closed. */
  rank?: number;
  votedByMe: boolean;
  starred: boolean;
  starredBy?: RoadmapPersonRef;
  unread: boolean;
  whyHere?: RoadmapWhyHere;
  goal?: { id: string; name: string };
  updatedAt: string;
  stageSince: string;
}

export type RoadmapDesignState = "none" | "draft" | "awaitingApproval" | "approved";

export interface RoadmapItemRun {
  id: string;
  phase: string;
  state: string;
  costUsd: number;
}

export interface RoadmapItemPr {
  repo: string;
  number: number;
  url: string;
  state: "open" | "merged" | "closed" | string;
  ci?: "pending" | "passing" | "failing";
}

export interface RoadmapItemRelease {
  service: string;
  state: "pending" | "live" | "failed";
  tag?: string;
  releasedAt?: string;
  repo?: string;
  prNumber?: number;
}

export interface RoadmapItemSummary {
  problem?: string;
  who?: string;
  outcome?: string;
  whyRanks?: unknown;
  images?: string[];
}

export interface RoadmapItemDetail extends RoadmapItemRow {
  summary: RoadmapItemSummary;
  /** The plan / builder session; its transcript comes from the existing builder endpoints. */
  sessionId?: string;
  prd?: { readinessPct: number; versionNumber: number };
  design?: { state: RoadmapDesignState };
  runs: RoadmapItemRun[];
  prs: RoadmapItemPr[];
  /** P1's `item_releases`. Empty (or absent) where P1 isn't deployed. */
  releases: RoadmapItemRelease[];
  outcome?: { review?: unknown };
  /** Absent for Viewers (D2) and for an idea with no session. */
  spend?: { spentUsd: number; ceilingUsd: number };
  people: RoadmapPersonRef[];
  can: RoadmapCan;
  watchLevel: RoadmapWatchLevel;
  reviewState?: "pending" | "accepted" | "declined";
  /** Present ONLY for the author and Owners. */
  declineReason?: string;
}

export interface RoadmapMeRole {
  role: RoadmapRole;
  can: Partial<Record<"configure" | "review" | "pinView" | "submit", boolean>>;
}

export type RoadmapQueueView = "for-you" | "leading" | "to-triage" | "all";

export type RoadmapQueueSort = "rank" | "waiting" | "newest" | "votes" | "activity" | "stageAge";

/** The query params of `GET /v1/roadmap/items`. Every value is a string, as it travels. */
export interface RoadmapItemsQuery {
  view: RoadmapQueueView;
  q?: string;
  stage?: string;
  review?: string;
  goal?: string;
  author?: string;
  lead?: string;
  service?: string;
  starred?: "1";
  openQuestion?: "1";
  votedByMe?: "1";
  month?: string;
  sort?: RoadmapQueueSort;
  cursor?: string;
}

export interface RoadmapForYouSections {
  needsYou: RoadmapItemRow[];
  yourIdeas: RoadmapItemRow[];
  watching: RoadmapItemRow[];
  recentlyShipped: RoadmapItemRow[];
}

export interface RoadmapTriageSections {
  awaitingReview: RoadmapItemRow[];
  needsLead: RoadmapItemRow[];
  reassign: RoadmapItemRow[];
}

export type RoadmapItemsResponse =
  | { sections: RoadmapForYouSections | RoadmapTriageSections | Record<string, RoadmapItemRow[]> }
  | { rows: RoadmapItemRow[]; nextCursor?: string; total: number };

export interface RoadmapSearchResponse {
  items: RoadmapItemRow[];
  recent: RoadmapItemRow[];
}

export interface RoadmapItemPatch {
  title?: string;
  goalId?: string;
  /** Only the problem is editable; who and outcome come from the copilot's brief. */
  summary?: { problem?: string };
  leadUserId?: number;
  plannedMonth?: string | null;
}

export interface RoadmapStarResponse {
  starred: boolean;
  starredBy?: RoadmapPersonRef;
}

/** Socket payloads on the existing roadmap namespace. */
export interface RoadmapItemChangedEvent {
  code: string;
  fields: string[];
  actorId?: number;
}

export interface RoadmapWatchResponse {
  itemId: string;
  level: RoadmapWatchLevel;
}

export interface RoadmapPresenceEvent {
  code: string;
  userId: number;
  name: string;
  kind: "viewing" | "typing";
  questionId?: string;
  at?: string;
}
