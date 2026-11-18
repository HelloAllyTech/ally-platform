import type {
  ItemStatusParts,
  ShownStage,
  SimpleStage,
} from 'src/product-planning/util/plan-stage.util';
import type {
  RoadmapCapabilities,
  RoadmapEditCapabilities,
  RoadmapRole,
} from 'src/product-planning/util/roadmap-role.util';
import type { RoadmapWatchLevel } from 'src/product-planning/enum/product-planning.enum';

/**
 * The Roadmap v2 read model's wire shapes (plans/roadmap-v2-build/P2-contract.md,
 * the frontend's source of truth). Data, never copy: the frontend words it.
 */

export type ItemRelation = 'author' | 'lead' | 'owner' | 'builder' | 'idea';

export interface PersonRef {
  id: number;
  name: string;
  role: RoadmapRole;
  relation?: ItemRelation;
  /**
   * Ideas this person filed that are Released (§4.14, "ideas shipped: 3" on
   * a chip). Positive only: nothing anywhere counts declined ideas.
   */
  ideasShipped?: number;
}

export type ItemCan = RoadmapCapabilities & RoadmapEditCapabilities;

export type WhyHereDecision =
  | 'approveDesign'
  | 'merge'
  | 'release'
  | 'budget'
  | 'settleAnswer'
  | 'startBuild'
  | 'unblock';

/** Why a row is in a view. */
export type WhyHere =
  | {
      kind: 'agentQuestion';
      phase: 'idea' | 'plan';
      questionPreview: string;
      since: string;
    }
  | { kind: 'mention'; by: PersonRef; since: string }
  | { kind: 'decision'; decision: WhyHereDecision; since: string }
  | { kind: 'awaitingReview'; since: string }
  | { kind: 'needsLead'; since: string }
  | { kind: 'reassign'; idleDays: number }
  | { kind: 'progress' }
  | { kind: 'shipped'; at: string };

export interface ItemRow {
  /** The opportunity uuid: what the existing vote endpoint takes. */
  id: string;
  code: string;
  title: string;
  shownStage: ShownStage;
  /** The stage in five words (Draft, Backlog, Being built, Shipped, Declined): what rows, filters and the tracker say. */
  stage: SimpleStage;
  statusParts: ItemStatusParts;
  author: PersonRef;
  lead?: PersonRef;
  votes: number;
  /**
   * Position in the queue, 1-based and unique, over every idea that is not yet released (the same
   * `queueRank` the sort uses, so the number can never disagree with the order). Absent once an
   * idea is released, declined or closed.
   */
  rank?: number;
  votedByMe: boolean;
  starred: boolean;
  starredBy?: PersonRef;
  unread: boolean;
  whyHere?: WhyHere;
  goal?: { id: string; name: string };
  /** 'YYYY-MM' the Owner planned it for, or null when unscheduled. */
  plannedMonth: string | null;
  updatedAt: string;
  stageSince: string;
}

export type ItemDesignState =
  | 'none'
  | 'draft'
  | 'awaitingApproval'
  | 'approved';

export interface ItemDetail extends ItemRow {
  summary: {
    problem?: string;
    who?: string;
    outcome?: string;
    whyRanks?: unknown;
    images?: string[];
  };
  sessionId?: string;
  prd?: { readinessPct: number; versionNumber: number };
  design?: { state: ItemDesignState };
  runs: Array<{ id: string; phase: string; state: string; costUsd: number }>;
  prs: Array<{
    repo: string;
    number: number;
    url: string;
    state: 'open' | 'merged' | 'closed';
    ci?: 'pending' | 'passing' | 'failing';
  }>;
  releases: Array<{
    service: string;
    state: 'pending' | 'live' | 'failed';
    tag?: string;
    releasedAt?: string;
    repo: string;
    prNumber: number;
  }>;
  outcome?: { review?: unknown };
  spend?: { spentUsd: number; ceilingUsd: number };
  people: PersonRef[];
  can: ItemCan;
  watchLevel: RoadmapWatchLevel;
  reviewState?: 'pending' | 'accepted' | 'declined';
  /** Present only for the author and Owners (D10, [FP-0992]). */
  declineReason?: string;
  /**
   * Where it started: who, when, how, and the rough idea as it was written
   * before the interview. Absent for an idea filed with no draft session.
   */
  origin?: ItemOrigin;
  /**
   * Everything that happened to it after the first word, oldest first, one
   * entry per milestone: submitted, planned, plan closed, builder assigned or
   * changed, build mode, releases going live, marked released, declined.
   * The conversation itself is the session transcript beside it.
   */
  timeline: ItemTimelineEntry[];
}

export interface ItemOrigin {
  startedAt: string;
  startedBy: PersonRef | null;
  captureMode: 'typed' | 'voice' | null;
  /** The idea as its author wrote it on the draft page. */
  roughIdea: string | null;
}

export type ItemTimelineKind =
  | 'submitted'
  | 'reviewed'
  | 'planning_started'
  | 'plan_closed'
  | 'plan_reopened'
  | 'lead_assigned'
  | 'lead_handed_back'
  | 'design_approved'
  | 'build_sent'
  | 'external_build'
  | 'build_mode_set'
  | 'release_live'
  | 'marked_released'
  | 'closed'
  | 'reopened'
  | 'item_edited'
  | 'answer_settled';

export interface ItemTimelineEntry {
  at: string;
  kind: ItemTimelineKind;
  actor: PersonRef | null;
  /**
   * Kind-specific facts, ids and values only (the UI writes the words):
   * lead_assigned { from, to } as PersonRefs; build_mode_set { from, to };
   * reviewed { decision }; item_edited { field }; release_live { service, tag }.
   */
  detail?: Record<string, unknown>;
}

export interface ForYouSections {
  needsYou: ItemRow[];
  yourIdeas: ItemRow[];
  watching: ItemRow[];
  recentlyShipped: ItemRow[];
}

/**
 * To triage is the Backlog: every idea nobody leads yet, in one list. Ideas that already have a
 * lead are Being built and live under Leading, not here.
 */
export interface ToTriageSections {
  backlog: ItemRow[];
}

export type ItemListResponse =
  | { sections: ForYouSections }
  | { sections: ToTriageSections }
  | { rows: ItemRow[]; nextCursor?: string; total: number };

export interface ItemSearchResponse {
  items: ItemRow[];
  recent: ItemRow[];
}
