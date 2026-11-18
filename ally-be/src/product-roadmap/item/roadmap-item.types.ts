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
  /** Position in the composite-score queue (1 = first); null when the idea is not ranked. */
  queueRank: number | null;
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
