/**
 * Course Copilot — mirror of ally-be `src/course-copilot/type/*.ts` and
 * `enum/course-copilot.enum.ts`. Change both sides together.
 */

import type { AgentTurnReceipt } from "./agentChat";

/* ── Enums ─────────────────────────────────────────────────────────────── */

export type CourseCopilotMode = "CREATE" | "EDIT";

export type CourseCopilotSessionStatus =
  | "INTERVIEWING"
  | "AWAITING_BLUEPRINT"
  | "BUILDING"
  | "BUILD_FAILED"
  | "EDITING"
  | "ARCHIVED";

export type CourseCopilotJobKind =
  | "course_meta"
  | "article"
  | "quiz"
  | "journal"
  | "annotated_artifact"
  | "game"
  | "video"
  | "roleplay_new"
  | "roleplay_ref"
  | "case_new"
  | "case_ref"
  | "cover_image"
  | "article_image"
  | "course_review";

export type CourseCopilotJobStatus = "queued" | "running" | "done" | "failed" | "skipped" | "held";

export type CourseCopilotEventType =
  | "build_started"
  | "job_queued"
  | "job_started"
  | "job_progress"
  | "job_done"
  | "job_failed"
  | "job_skipped"
  | "structure_written"
  | "budget_hold"
  | "review_ready"
  | "build_finished"
  | "build_failed"
  | "course_changed";

/** Track 2.0 item types — the only types a course can hold. */
export type CourseItemType =
  | "ROLEPLAY"
  | "CASE"
  | "QUIZ"
  | "ARTICLE"
  | "VIDEO"
  | "JOURNAL"
  | "ANNOTATED_ARTIFACT"
  | "GAME"
  | "BRANCHING_SCENARIO"
  | "BUCKET_SORT";

/* ── Brief ─────────────────────────────────────────────────────────────── */

export type CourseBriefAssessmentKind = "roleplay" | "quiz" | "annotated_artifact" | "journal";
export type CourseBriefComponent =
  | "article"
  | "video"
  | "journal"
  | "annotated_artifact"
  | "game"
  | "quiz";

export interface CourseBriefPracticeSlot {
  slot: number;
  source: "library" | "new";
  scenarioId?: number;
  caseId?: string;
  characterId?: string;
  personaBrief?: string;
  taskClass?: string;
  minScore?: number;
  triggerWarningIds?: string[];
  saveCharacter?: boolean;
}

export interface CourseBrief {
  seed?: string;
  audience?: {
    who?: string;
    priorExperience?: string;
    applicationContext?: string;
    groupNote?: string;
  };
  outcomes?: { terminal?: string; enabling?: string[] };
  competencyIds?: string[];
  competencyNames?: string[];
  behaviours?: { helpful?: string[]; unhelpful?: string[] };
  assessment?: { kind?: CourseBriefAssessmentKind; note?: string; threshold?: number };
  shape?: {
    durationMinutes?: number;
    sections?: number;
    practiceWeight?: "practice-heavy" | "balanced" | "reading-heavy";
    components?: CourseBriefComponent[];
    tone?: string;
    readingLevel?: string;
    languageIds?: string[];
  };
  practice?: CourseBriefPracticeSlot[];
  look?: {
    cover?: "generate" | "library" | "upload-later";
    coverImageUrl?: string;
    articleImages?: "none" | "cover-only" | "one-per-article";
  };
  videoUrls?: {
    title: string;
    url: string;
    source: "youtube" | "vimeo" | "loom" | "s3";
    durationSeconds?: number;
  }[];
  notes?: string[];
}

export interface CourseBriefReadiness {
  ready: boolean;
  /** Human-readable names of fields still missing. */
  missing: string[];
}

/* ── Blueprint ─────────────────────────────────────────────────────────── */

export type CourseBlueprintItemSource =
  | { kind: "new" }
  | { kind: "library"; scenarioId?: number; caseId?: string; templateId?: string }
  | { kind: "needs-input"; what: "video-url" };

export interface CourseBlueprintCompletionCriteria {
  minScore?: number;
  passScore?: number;
  watchPct?: number;
  minReadSeconds?: number;
  minDurationSeconds?: number;
}

export interface CourseBlueprintItem {
  /** Stable across edits — mint with crypto.randomUUID() for new items. */
  id: string;
  type: CourseItemType;
  title: string;
  purpose: string;
  /** Indexes into brief.outcomes.enabling. */
  objectiveRefs: number[];
  estimatedMinutes: number;
  source: CourseBlueprintItemSource;
  /** Per-type generation brief; opaque to the UI except spec.url for VIDEO. */
  spec: Record<string, unknown>;
  completionCriteria?: CourseBlueprintCompletionCriteria;
  hasDiscussion?: boolean;
}

export interface CourseBlueprintSection {
  id: string;
  title: string;
  description: string;
  purpose: string;
  items: CourseBlueprintItem[];
}

export interface CourseBlueprintEstimate {
  usd: number;
  minutes: number;
  items: number;
  newRoleplays: number;
  images: number;
}

export interface CourseBlueprint {
  title: string;
  description: string;
  estimatedDurationMinutes: number;
  competencyIds: string[];
  cover: { mode: "generate" | "library" | "upload-later"; prompt?: string; imageUrl?: string };
  sections: CourseBlueprintSection[];
  estimate: CourseBlueprintEstimate;
}

/* ── Course (built) ────────────────────────────────────────────────────── */

export type CourseItemPreview =
  | {
      type: "ARTICLE";
      excerpt: string;
      wordCount: number;
      questionCount: number;
      resourceCount: number;
      imageUrls: string[];
    }
  | {
      type: "QUIZ";
      questionCount: number;
      passScore: number | null;
      sampleQuestion: string | null;
      questionTypes: string[];
    }
  | { type: "JOURNAL"; prompts: string[] }
  | {
      type: "ANNOTATED_ARTIFACT";
      unitCount: number;
      labels: string[];
      targetCount: number;
      intro: string | null;
    }
  | {
      type: "ROLEPLAY";
      scenarioId: number | null;
      scenarioTitle: string | null;
      coverImageUrl: string | null;
      generated: boolean;
    }
  | {
      type: "CASE";
      caseId: string | null;
      caseTitle: string | null;
      roleplayCount: number;
      generated: boolean;
    }
  | { type: "GAME"; gameKey: string | null; intro: string | null }
  | { type: "VIDEO"; source: string | null; url: string | null };

export interface CourseOutlineItem {
  id: string;
  type: CourseItemType;
  order: number;
  title: string;
  description?: string | null;
  scenarioId?: number | null;
  caseId?: string | null;
  completionCriteria?: Record<string, unknown> | null;
  /** "6 questions", "820 words, 2 checks", … */
  size: string;
  hasDiscussion?: boolean;
  preview: CourseItemPreview;
}

export interface CourseOutlineSection {
  id: string;
  order: number;
  title: string;
  description?: string | null;
  items: CourseOutlineItem[];
}

export interface CourseOutline {
  trackId: string;
  title: string;
  description: string | null;
  coverImageUrl: string | null;
  status: string;
  estimatedDurationMinutes: number | null;
  competencyIds: string[] | null;
  structureLocked: boolean;
  sections: CourseOutlineSection[];
}

export interface CoursePublishReadiness {
  ready: boolean;
  checks: { key: string; label: string; ok: boolean; detail?: string }[];
}

export interface CourseChangeLogEntry {
  at: string;
  summary: string;
  tool: string;
  itemId?: string;
  sectionId?: string;
}

/* ── REST ──────────────────────────────────────────────────────────────── */

export interface CourseCopilotBudget {
  /** 0 = uncapped. */
  ceilingUsd: number;
  spentUsd: number;
  remainingUsd: number | null;
  held: boolean;
}

export interface CourseCopilotSessionSummary {
  id: string;
  title: string;
  mode: CourseCopilotMode;
  status: CourseCopilotSessionStatus;
  trackId: string | null;
  trackTitle: string | null;
  trackStatus: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CourseCopilotServerMessage {
  id: string;
  seq: number;
  role: "user" | "assistant";
  content: string | null;
  toolCalls: { id: string; name: string; input: Record<string, unknown> }[] | null;
  toolResults: { toolUseId: string; name: string; result: unknown }[] | null;
  metadata: {
    questions?: CourseCopilotQuestionEvent[];
    questionId?: string;
    answer?: CourseCopilotStructuredAnswer;
    errored?: boolean;
    errorMessage?: string;
    streaming?: boolean;
    interrupted?: boolean;
    /** Present on the reviewer's post-build message. */
    reviewNotes?: { findings: CourseReviewFinding[] };
    /** Suggested-action chips the server attached to this message. */
    suggestedActions?: CourseCopilotSuggestedAction[];
    [key: string]: unknown;
  } | null;
  createdAt: string;
}

export interface CourseReviewFinding {
  severity: "fix" | "consider";
  itemId?: string;
  note: string;
  suggestedAction?: { tool: string; input: Record<string, unknown> };
}

/** A chip under a message: clicking sends `message` as the trainer's next turn. */
export interface CourseCopilotSuggestedAction {
  label: string;
  message: string;
}

export interface CourseCopilotJob {
  id: string;
  kind: CourseCopilotJobKind;
  blueprintItemId: string | null;
  title: string;
  status: CourseCopilotJobStatus;
  attempts: number;
  error: string | null;
  summary: string | null;
  skippedReason: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  costUsd: number | null;
  scenarioId: number | null;
  caseId: string | null;
}

export interface CourseCopilotEvent {
  seq: number;
  type: CourseCopilotEventType;
  payload: Record<string, unknown>;
  createdAt: string;
}

export interface CourseCopilotSessionDetail {
  session: CourseCopilotSessionSummary & {
    brief: CourseBrief;
    briefReadiness: CourseBriefReadiness;
    blueprint: CourseBlueprint | null;
    blueprintVersion: number;
    approvedBlueprint: CourseBlueprint | null;
    changeLog: CourseChangeLogEntry[];
    generatedScenarioIds: number[];
    generatedCaseIds: string[];
  };
  messages: CourseCopilotServerMessage[];
  jobs: CourseCopilotJob[];
  events: CourseCopilotEvent[];
  lastEventSeq: number;
  outline: CourseOutline | null;
  readiness: CoursePublishReadiness | null;
  budget: CourseCopilotBudget;
}

export interface CourseCopilotBlueprintResponse {
  blueprint: CourseBlueprint;
  version: number;
  estimate: CourseBlueprintEstimate;
  budget: CourseCopilotBudget;
  /** Problems that block approval. Empty = approvable. */
  problems: string[];
}

/* ── Chat + SSE ────────────────────────────────────────────────────────── */

export type CourseCopilotQuestionKind = "freeText" | "singleSelect" | "multiSelect" | "dropdown";

export interface CourseCopilotQuestionOption {
  id: string;
  label: string;
  description?: string;
  recommended?: boolean;
}

export interface CourseCopilotQuestionEvent {
  id: string;
  prompt: string;
  kind: CourseCopilotQuestionKind;
  options?: CourseCopilotQuestionOption[];
  allowCustom?: boolean;
  allowNone?: boolean;
  minSelections?: number;
  maxSelections?: number;
  rationale?: string;
}

export interface CourseCopilotStructuredAnswer {
  selectedOptionIds?: string[];
  customValues?: string[];
  none?: boolean;
}

export interface CourseCopilotDoneEvent {
  messageSeq: number;
  sessionStatus: CourseCopilotSessionStatus;
  blueprintVersion?: number;
}

export type CourseCopilotStreamEvent =
  | { type: "token"; data: { delta: string } }
  | { type: "tool_call"; data: { name: string; input: Record<string, unknown> } }
  | { type: "tool_result"; data: { name: string; summary: string; ok?: boolean } }
  | { type: "question"; data: CourseCopilotQuestionEvent }
  | { type: "brief"; data: { brief: CourseBrief; readiness: CourseBriefReadiness } }
  | { type: "blueprint"; data: CourseCopilotBlueprintResponse }
  | { type: "course_patch"; data: { summary: string; outline: CourseOutline | null } }
  | { type: "build_started"; data: { jobCount: number; estimateUsd?: number } }
  /** Once per turn, just before `done`. */
  | { type: "receipt"; data: AgentTurnReceipt }
  | { type: "error"; data: { code: string; message: string } }
  | { type: "done"; data: CourseCopilotDoneEvent }
  | { type: "ping"; data: { at: number } };

/** One rendered row in the chat feed. */
export interface CourseCopilotChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  /** Short tool activity notes for this turn ("Searched the library…"). */
  toolNotes?: string[];
  question?: CourseCopilotQuestionEvent;
  answeredWith?: string;
  answeredAnswer?: CourseCopilotStructuredAnswer;
  isStreaming?: boolean;
  interrupted?: boolean;
  error?: string;
  /** The reviewer's findings, rendered as a list with action chips. */
  reviewFindings?: CourseReviewFinding[];
  suggestedActions?: CourseCopilotSuggestedAction[];
  /**
   * What the turn did, drawn under the bubble. Replaces the turn's tool notes once it lands — the
   * receipt is the record. Absent on rows from before receipts existed.
   */
  receipt?: AgentTurnReceipt;
}

/**
 * A feed row plus the client-only flags the stream hook sets. Kept apart from
 * `CourseCopilotChatMessage` so that interface (which the work pane also reads) stays as mirrored.
 */
export interface CourseCopilotFeedMessage extends CourseCopilotChatMessage {
  /**
   * `error` is transient (provider hiccup, dropped connection) — render a Retry chip that re-sends
   * the last user turn. Absent for errors a retry cannot fix (misconfigured, budget, locked).
   */
  retryable?: boolean;
}
