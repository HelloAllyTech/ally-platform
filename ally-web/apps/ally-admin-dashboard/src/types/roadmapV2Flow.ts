/**
 * Roadmap v2's write side for New idea, drafts, review and the one attributed session (P3 / P3b),
 * as plans/roadmap-v2-build/P2-contract.md "P3 routes" defines it. Every route answers 404 while
 * `roadmap_v2` is off. The read model's shapes live beside this in `roadmapV2.ts`.
 *
 * Kept in its own file (not re-exported from the types barrel) so it merges cleanly beside the
 * parallel P4 work; import it by path.
 */
import type { RoadmapOpportunityBrief } from "./productRoadmap";
import type {
  RoadmapItemDetail,
  RoadmapItemRow,
  RoadmapPersonRef,
  RoadmapShownStage,
} from "./roadmapV2";

/** The filing gate's five criteria, in the order the draft page lists them. */
export type RoadmapCheckId =
  | "who_it_affects"
  | "pain_or_gain"
  | "clear_why"
  | "goal_before_solution"
  | "outcome";

export const ROADMAP_CHECK_ORDER: RoadmapCheckId[] = [
  "who_it_affects",
  "pain_or_gain",
  "clear_why",
  "goal_before_solution",
  "outcome",
];

export interface RoadmapCheckEvidence {
  /** The words that met the check, verbatim. */
  quote: string;
  /** Where to highlight it: the idea text, or one of the author's answers. */
  from: "text" | "answer";
  messageId?: string;
}

export interface RoadmapDraftCheck {
  id: RoadmapCheckId;
  /** From the server, so the page never holds its own copy of the gate. */
  label: string;
  hint: string;
  met: boolean;
  source: "agent" | "self" | null;
  evidence: RoadmapCheckEvidence | null;
  note: string | null;
  /** "Not quite" was pressed; true until the agent's next turn. */
  reopened: boolean;
}

export interface RoadmapDraftMessage {
  id: string;
  seq: number;
  from: "author" | "agent";
  text: string;
  at: string;
  idempotencyKey?: string;
  /** The agent's "I have enough" line at the $1 idea cap. */
  wrapUp?: boolean;
}

export interface RoadmapGoalRef {
  id: string;
  name: string;
}

export interface RoadmapDraftDetail {
  code: string;
  sessionId: string;
  shownStage: "draft";
  statusParts: { stage: "draft"; checksMet: number; checksTotal: number };
  /** The whole idea; the title is its first line. */
  text: string;
  title: string;
  goal: RoadmapGoalRef | null;
  suggestedGoal: RoadmapGoalRef | null;
  checks: RoadmapDraftCheck[];
  checksMet: number;
  checksTotal: number;
  canSubmit: boolean;
  selfChecked: boolean;
  /** The agent failed twice in a row: offer Fill it in yourself. */
  selfCheckOffered: boolean;
  checkedAt: string | null;
  conversation: RoadmapDraftMessage[];
  /** Bumps on every save; sent back as baseVersion. */
  version: number;
  savedAt: string;
  createdAt: string;
  archivedAt: string | null;
  archiveAt: string | null;
  purgeAt: string | null;
  spend: { spentUsd: number; ideaCapUsd: number; wrapUp: boolean };
  /** The one character limit for the idea's text; Submit files against the same one. Older servers omit it. */
  textMax?: number;
  /** The idea agent's statement and a short title, for "What will be submitted"; null until it has drafted one. */
  proposal?: RoadmapDraftProposal | null;
  /** The idea agent's research brief, for "What the idea agent found"; null until its first turn. */
  brief?: RoadmapOpportunityBrief | null;
}

/**
 * The one character limit for an idea's text on the Roadmap v2 pages: the capture box, a draft
 * and what Submit files. Mirrors ally-be's ROADMAP_LIMITS.DESCRIPTION_MAX; a draft also carries
 * the server's own value as `textMax`, which wins where it is known.
 */
export const ROADMAP_IDEA_TEXT_MAX = 1000;

export interface RoadmapDraftProposal {
  title: string;
  statement: string;
}

/** What Submit files: the author's own words ("mine", what leaving it out means) or the agent's, as edited. */
export interface RoadmapSubmitChoice {
  use: "mine" | "agent";
  title?: string;
  statement?: string;
}

export interface RoadmapDraftRow {
  code: string;
  title: string;
  checksMet: number;
  checksTotal: number;
  updatedAt: string;
  archivedAt: string | null;
  archiveAt: string | null;
  purgeAt: string | null;
}

export interface RoadmapSimilarIdea {
  code: string;
  title: string;
  shownStage: RoadmapShownStage;
  votes: number;
  reason: string;
}

export interface RoadmapDraftCreate {
  text: string;
  goalId?: string | null;
  captureMode?: "typed" | "voice";
}

export interface RoadmapDraftPatch {
  text?: string;
  goalId?: string | null;
  baseVersion?: number;
}

export interface RoadmapDraftPatchResult {
  code: string;
  title: string;
  version: number;
  savedAt: string;
  checksMet: number;
  checksTotal: number;
}

/** "Fill it in yourself": one short field per check (1..200 characters each). */
export interface RoadmapSelfCheck {
  who: string;
  pain: string;
  why: string;
  goal: string;
  outcome: string;
}

export interface RoadmapSubmitResult {
  item: RoadmapItemDetail;
  /** This person's first ever submitted idea: show the first-submit note (§4.14). */
  firstSubmit: boolean;
}

export interface RoadmapAddToResult {
  target: { code: string };
  voted: boolean;
  commentId: string;
}

export interface RoadmapDictationResult {
  text: string;
  durationMs: number;
}

// ── review, lead ────────────────────────────────────────────────────────────────────────────────

export type RoadmapReviewDecision = "accept" | "decline" | "reopen";

export interface RoadmapReviewRequest {
  decision: RoadmapReviewDecision;
  leadUserId?: number;
  reason?: string;
}

export interface RoadmapBatchReviewItem extends RoadmapReviewRequest {
  code: string;
}

export interface RoadmapReviewResult {
  item: RoadmapItemDetail;
  undoToken: string;
}

export interface RoadmapBatchReviewResult {
  items: RoadmapItemRow[];
  undoToken: string;
}

export type RoadmapLeadRequest =
  | { action: "assign"; leadUserId: number }
  | { action: "handBack"; note?: string };

export interface RoadmapLeadCandidate {
  user: RoadmapPersonRef;
  leading: number;
  limit: number;
  freeSlots: number;
  appsTouched: string[];
  matchingIdeas: number;
  score: number;
}

export interface RoadmapLeadSuggestions {
  suggestedUserId: number | null;
  candidates: RoadmapLeadCandidate[];
}

// ── P3b: one attributed session ─────────────────────────────────────────────────────────────────

export interface RoadmapConversationPost {
  id: string;
  seq: number;
  kind: "answer" | "comment" | "settled";
  questionId?: string;
  text: string;
  optionIds?: string[];
  by: RoadmapPersonRef;
  mentions?: RoadmapPersonRef[];
  /** settled: the answer chosen. */
  chosenPostId?: string;
  at: string;
  idempotencyKey: string;
}

export interface RoadmapQuestionAnswers {
  questionId: string;
  prompt: string;
  options?: { id: string; label: string }[];
  /** Each person's latest answer, oldest first. */
  answers: RoadmapConversationPost[];
  /** Two or more people, different answers, not yet settled. */
  conflict: boolean;
  /** The lead; the author before a lead exists. */
  settler: RoadmapPersonRef | null;
  chosenPostId: string | null;
  settledBy: RoadmapPersonRef | null;
  /** Already handed to the agent. */
  batched: boolean;
}

export interface RoadmapSessionAnswers {
  questions: RoadmapQuestionAnswers[];
  comments: RoadmapConversationPost[];
}

export interface RoadmapAnswerRequest {
  sessionId: string;
  questionId: string;
  text?: string;
  optionIds?: string[];
  idempotencyKey: string;
}

export interface RoadmapCommentRequest {
  sessionId: string;
  text: string;
  mentionUserIds?: number[];
  idempotencyKey: string;
}

/** The error body most of these routes send: a code the UI branches on, and a sentence. */
export interface RoadmapFlowError {
  status?: number;
  data?: {
    code?: string;
    message?: string;
    missing?: RoadmapCheckId[];
    failures?: number | { code: string; message: string }[];
    current?: RoadmapDraftDetail;
    codes?: string[];
  };
}
