import { DebriefCardsData } from "./debriefConsole";

/** Why a debrief is in the expert review queue (ally-be `REVIEW_SOURCES`). */
export type ExpertReviewReason =
  | "risk_cue"
  | "below_bar"
  | "learner_flag"
  | "disagreement"
  | "sample";

export type ExpertVerdict = "good" | "needs_work";

export type ExpertCommentAnchor = "transcript" | "card" | "debrief";

export type ExpertCommentTag =
  | "missed_moment"
  | "wrong_or_unsupported"
  | "tone"
  | "advice_doesnt_fit"
  | "protocol"
  | "language"
  | "too_long_or_unclear"
  | "good_keep_this";

export interface ExpertQueueItem {
  runId: string;
  sessionId: string;
  status: string;
  mode: "live" | "shadow";
  language: string | null;
  sessionType: string | null;
  tenantId: string | null;
  tenantName: string | null;
  createdAt: string;
  reasons: ExpertReviewReason[];
  commentCount: number;
  reviewCount: number;
  myVerdict: ExpertVerdict | null;
  /** Null until the caller has given a verdict on this debrief. */
  judgeOverall: number | null;
}

export interface ExpertQueue {
  items: ExpertQueueItem[];
  filters: {
    tenants: Array<{ id: string; name: string }>;
    languages: string[];
    sessionTypes: string[];
  };
}

export interface ExpertQueueFilters {
  tenantId?: string;
  language?: string;
  sessionType?: string;
  source?: ExpertReviewReason;
  includeReviewed?: boolean;
}

export interface ExpertTranscriptTurn {
  turnIndex: number;
  speaker: "client" | "learner";
  text: string;
  gap: boolean;
  riskCue: { category: string; learnerResponse: string } | null;
}

export interface ExpertComment {
  id: string;
  runId: string;
  parentId: string | null;
  anchorKind: ExpertCommentAnchor;
  turnIndex: number | null;
  section: string | null;
  spanStart: number | null;
  spanEnd: number | null;
  quotedText: string | null;
  body: string;
  tag: ExpertCommentTag | null;
  status: "open" | "resolved";
  reviewer: { id: number; name: string | null };
  mine: boolean;
  createdAt: string;
  updatedAt: string;
  resolvedAt: string | null;
  /** The PM agent idea this comment fed (agent_lessons status). */
  idea: { id: string; title: string | null; status: string | null } | null;
  repeatOf: { id: string; runId: string | null; body: string | null } | null;
}

export interface ExpertMyComment extends ExpertComment {
  language: string | null;
  sessionType: string | null;
}

export interface ExpertReviewDetail {
  run: {
    id: string;
    sessionId: string;
    status: string;
    mode: "live" | "shadow";
    language: string | null;
    sessionType: string | null;
    tenantName: string | null;
    createdAt: string;
    hasRiskCue: boolean;
    learnerDistress: boolean;
    releaseVersion: number | null;
  };
  transcript: ExpertTranscriptTurn[];
  cards: DebriefCardsData;
  corrections: Array<{ section: string | null; outcome: string; note: string | null }>;
  flags: Array<{
    id: string;
    section: string | null;
    reason: string | null;
    note: string | null;
    status: string;
    resolutionNote: string | null;
    createdAt: string;
  }>;
  comments: ExpertComment[];
  myReview: { verdict: ExpertVerdict; hardFails: string[]; updatedAt: string } | null;
  otherReviews: {
    count: number;
    verdicts: Array<{ verdict: ExpertVerdict; hardFails: string[] }> | null;
  };
  judge: { overall: number | null; hardFails: string[] } | null;
  evaluator: { overall: number | null; hardFails: string[] } | null;
  hardFailCodes: string[];
}

/** A selection waiting to become a comment. */
export interface ExpertCommentDraftAnchor {
  anchorKind: ExpertCommentAnchor;
  turnIndex?: number;
  section?: string;
  spanStart?: number;
  spanEnd?: number;
  quotedText?: string;
}

export interface NewExpertComment extends ExpertCommentDraftAnchor {
  body: string;
  tag?: ExpertCommentTag | null;
  parentId?: string;
}
