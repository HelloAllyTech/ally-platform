/**
 * Types for the Ally Console's M3/M4 surfaces: the configuration plane, advice moderation, the
 * library, the learning loop (evaluator, reviews, eval cases and runs) and the course builder's
 * notes for Ally. They mirror ally-be's controllers; see the endpoint constants for the routes.
 */

// ── Configuration plane (plan §7.5) ──────────────────────────────────────────────

export type AllyGuideConfigValue = number | boolean | string | null;
export type AllyGuideConfigOverrideLayer = "org" | "course" | "learner";
/** The layers an admin edits from the Console. */
export type AllyGuideConfigEditLayer = "org" | "course";
export type AllyGuideConfigSource = "release" | AllyGuideConfigOverrideLayer | "runtime";

/** One policy key as a generated form needs it. */
export interface AllyGuideConfigField {
  key: string;
  type: "int" | "number" | "boolean" | "enum";
  min?: number;
  max?: number;
  enum?: string[];
  nullable?: boolean;
  unit?: string;
  description: string;
  overridableBy: AllyGuideConfigOverrideLayer[];
  /** Safety or White Hat core: never overridable. */
  pinned?: boolean;
  group: string;
  learnerLever?: string;
  /** What the live release uses when nothing overrides the key. */
  releaseValue: AllyGuideConfigValue;
}

export interface AllyGuideConfigSchema {
  fields: AllyGuideConfigField[];
}

export interface AllyGuideConfigLayerField extends AllyGuideConfigField {
  override: { value: AllyGuideConfigValue } | null;
}

export interface AllyGuideConfigAuditRow {
  layer: AllyGuideConfigEditLayer;
  scopeId: string;
  /** The organisation's name or the course's title; null once it is gone. */
  scopeName: string | null;
  key: string;
  oldValue: { value: unknown } | null;
  newValue: { value: unknown } | null;
  version: number;
  actor: string | null;
  actorUserId: number | null;
  createdAt: string;
}

export interface AllyGuideConfigLayerView {
  layer: AllyGuideConfigEditLayer;
  scopeId: string;
  scopeName: string | null;
  /** 0 when nothing has been saved; sent back as `expectedVersion`. */
  version: number;
  updatedAt: string | null;
  updatedBy: string | null;
  /** Only the keys this layer may set. */
  fields: AllyGuideConfigLayerField[];
  audit: AllyGuideConfigAuditRow[];
}

export interface AllyGuideConfigOverrideRow {
  layer: AllyGuideConfigEditLayer;
  scopeId: string;
  scopeName: string | null;
  values: Record<string, AllyGuideConfigValue>;
  version: number;
  updatedAt: string;
  updatedBy: string | null;
}

export interface SaveAllyGuideConfigBody {
  layer: AllyGuideConfigEditLayer;
  /** The organisation's or the course's id. */
  scopeId: string;
  set?: Record<string, AllyGuideConfigValue>;
  clear?: string[];
  expectedVersion?: number;
}

export interface AllyGuideConfigExplainEntry {
  key: string;
  group: string;
  value: AllyGuideConfigValue;
  source: AllyGuideConfigSource;
  /** Every layer that set it, lowest first; the last one won. */
  chain: { layer: AllyGuideConfigSource; value: AllyGuideConfigValue; reason?: string }[];
  releaseValue: AllyGuideConfigValue;
  unit: string | null;
  description: string;
  overridableBy: AllyGuideConfigOverrideLayer[];
  pinned: boolean;
  learnerLever: string | null;
  /** Saved since this epoch began: what the next epoch will use. */
  pending: { value: AllyGuideConfigValue; source: AllyGuideConfigSource } | null;
}

export interface AllyGuideConfigExplanation {
  threadId: string;
  epoch: number;
  epochStartedAt: string | null;
  releaseId: string | null;
  releaseVersion: number | null;
  /** GA has moved on: the next epoch runs this release instead. */
  nextReleaseId: string | null;
  overridesPending: boolean;
  runtime: {
    mode: string;
    tier: string | null;
    model: string | null;
    guidance: string;
    visitor: boolean;
  };
  entries: AllyGuideConfigExplainEntry[];
  /** Stored values the schema refused (stale rows); never applied. */
  ignored: { layer: AllyGuideConfigSource; key: string; value: unknown; why: string }[];
}

// ── Advice moderation ────────────────────────────────────────────────────────────

export type AllyGuideAdviceStatus = "pending" | "approved" | "rejected";

/** A line a finisher left at the mentor door. The author is never part of it. */
export interface AllyGuideAdviceLine {
  id: string;
  text: string;
  status: AllyGuideAdviceStatus;
  flags: string[];
  trackId: string;
  trackTitle: string | null;
  tenantId: string;
  organisationName: string | null;
  createdAt: string;
  moderatedAt: string | null;
  rejectReason: string | null;
}

export interface ModerateAllyGuideAdviceBody {
  id: string;
  decision: "approve" | "reject";
  reason?: string;
}

// ── Library ──────────────────────────────────────────────────────────────────────

export type AllyGuideLibraryScope = "platform" | "organisation";

export interface AllyGuideLibraryDocument {
  id: string;
  title: string;
  sourceType: "paste" | "pdf" | "docx" | "epub" | "url";
  sourceUrl: string | null;
  fileName: string | null;
  sizeBytes: number | null;
  language: string | null;
  tags: string[];
  status: "pending" | "extracting" | "chunking" | "indexing" | "indexed" | "failed";
  /** The failure reason, verbatim. */
  statusMessage: string | null;
  chunkCount: number;
  indexedChunkCount: number;
  isArchived: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AllyGuideLibraryList {
  documents: AllyGuideLibraryDocument[];
  count: number;
}

export interface AllyGuideLibraryListQuery {
  scope: AllyGuideLibraryScope;
  /** Required for the organisation library. */
  tenantId?: string;
  limit?: number;
  offset?: number;
}

export interface CreateAllyGuideLibraryDocumentBody {
  scope: AllyGuideLibraryScope;
  tenantId?: string;
  title: string;
  sourceType: "paste" | "pdf" | "docx" | "epub";
  text?: string;
  fileUrl?: string;
  fileName?: string;
  contentType?: string;
  sizeBytes?: number;
  language?: string;
}

export interface AllyGuideLibraryUploadUrlBody {
  scope: AllyGuideLibraryScope;
  tenantId?: string;
  fileName: string;
  fileSize: number;
  contentType: string;
}

export interface AllyGuideLibraryUploadUrl {
  presignedUrl: string;
  fileUrl: string;
}

// ── Evaluator ────────────────────────────────────────────────────────────────────

export interface AllyGuideRubricCriterion {
  id: string;
  label: string;
  pass: string;
  fail: string;
  safety: boolean;
}

export interface AllyGuideRubric {
  criteria: AllyGuideRubricCriterion[];
  redTeamCategories: { id: string; safety: boolean; brief: string }[];
}

export interface AllyGuideEvaluatorNight {
  night: string;
  windows: number;
  judged: number;
  checkedOnly: number;
  errors: number;
  flagged: number;
  safetyFlags: number;
  disagreements: number;
  costUsd: number;
}

export interface AllyGuideEvaluatorSummary {
  nights: AllyGuideEvaluatorNight[];
  checks: { id: string; failed: number; applicable: number }[];
  criteria: { id: string; failed: number; applicable: number }[];
  spentTodayUsd: number;
}

export interface AllyGuideCriterionAgreement {
  criterion: string;
  pairs: number;
  agreement: number | null;
  kappa: number | null;
  trusted: boolean;
  reason: string;
}

export interface AllyGuideKappa {
  threshold: number;
  minPairs: number;
  critic: AllyGuideCriterionAgreement[];
  verifier: AllyGuideCriterionAgreement[];
  trusted: string[];
  labelledReviews: number;
}

// ── Reviews ──────────────────────────────────────────────────────────────────────

export type AllyGuideReviewReason = "safety_flag" | "disagreement" | "thumbs_down" | "calibration";
export type AllyGuideReviewStatus = "open" | "claimed" | "done" | "dismissed";
export type AllyGuideRubricVerdict = "pass" | "fail" | "na";

export interface AllyGuideReviewListItem {
  id: string;
  reason: AllyGuideReviewReason;
  status: AllyGuideReviewStatus;
  priority: number;
  turnId: string;
  threadId: string;
  reviewerId: number | null;
  claimedAt: string | null;
  completedAt: string | null;
  verdict: "ok" | "problem" | null;
  createdAt: string;
  night: string | null;
  flags: string[] | null;
  failedChecks: string[] | null;
}

export interface AllyGuideReviewList {
  items: AllyGuideReviewListItem[];
  counts: { reason: AllyGuideReviewReason; status: AllyGuideReviewStatus; n: number }[];
}

export interface AllyGuideReviewDetail {
  review: {
    id: string;
    status: AllyGuideReviewStatus;
    reason: AllyGuideReviewReason;
    turnId: string;
    threadId: string;
    reviewerId: number | null;
    labels: Record<string, AllyGuideRubricVerdict> | null;
    verdict: "ok" | "problem" | null;
    notes: string | null;
  };
  rubric: AllyGuideRubricCriterion[];
  /** Redacted text. Null when the conversation has since been deleted. */
  window: {
    situation: {
      mode: string;
      channel: string;
      budgetWords: number | null;
      steerLevel: string | number | null;
      releaseWindowOpen: boolean;
      quizOpen: boolean;
      overlay: string | null;
    };
    recent: { role: string; text: string }[];
    learnerText: string | null;
    reply: { text: string; kind: string };
    tools: { name: string; reason: string | null }[];
    flags: string[];
  } | null;
  feedback: { rating: number; comment: string | null } | null;
  evaluation: {
    id: string;
    night: string;
    sample: string;
    deterministic: {
      id: string;
      passed: boolean;
      applicable?: boolean;
      severity?: string;
      detail?: string;
    }[];
    /** Withheld until the review is closed. */
    disagreements?: unknown[];
    critic?: {
      criteria?: Record<string, { verdict: AllyGuideRubricVerdict; reason: string }>;
    } | null;
    verifier?: {
      criteria?: Record<string, { verdict: AllyGuideRubricVerdict; reason: string }>;
    } | null;
  } | null;
  /** True until the review is labelled: the judges' verdicts are not in this response. */
  judgesHidden: boolean;
}

export interface SubmitAllyGuideReviewBody {
  id: string;
  labels: Record<string, AllyGuideRubricVerdict>;
  verdict: "ok" | "problem";
  notes?: string;
  saveAsCase?: boolean;
}

// ── Eval suites, cases, runs ─────────────────────────────────────────────────────

export interface AllyGuideEvalSuite {
  id: string;
  key: string;
  name: string;
  kind: "smoke" | "regression" | "red_team";
  description: string | null;
  active: number;
  proposed: number;
  safety: number;
}

export type AllyGuideEvalCaseStatus = "proposed" | "active" | "retired";

export interface AllyGuideEvalCase {
  id: string;
  suiteId: string;
  source: "trace" | "failed_turn" | "review" | "red_team" | "counterfactual" | "manual";
  status: AllyGuideEvalCaseStatus;
  category: string;
  safety: boolean;
  title: string;
  parentCaseId: string | null;
  sourceTurnId: string | null;
  createdAt: string;
}

export interface AllyGuideEvalCasesQuery {
  suite?: string;
  status?: AllyGuideEvalCaseStatus;
  category?: string;
  limit?: number;
}

export interface SaveAllyGuideEvalCaseBody {
  turnId: string;
  kind: "regression" | "golden";
  title?: string;
  notes?: string;
}

export interface AllyGuideGateDecision {
  passed: boolean;
  reasons: string[];
  safetyFailures: number;
  safetyFailedCases: string[];
  quality: {
    candidateCasesPassed: number;
    baselineCasesPassed: number | null;
    qualityCases: number;
    candidateMean: number | null;
    baselineMean: number | null;
  };
  target: { cases: number; candidate: number; baseline: number } | null;
  guard: { status: "pass" | "fail" | "pending"; reason: string };
}

export type AllyGuideEvalRunStatus = "queued" | "running" | "passed" | "failed" | "error";

export interface AllyGuideEvalRun {
  id: string;
  releaseId: string;
  baselineReleaseId: string | null;
  kind: "smoke" | "gate";
  status: AllyGuideEvalRunStatus;
  repetitions: number;
  caseCount: number;
  summary: { decision?: AllyGuideGateDecision; targetCaseIds?: string[] } & Record<string, unknown>;
  costUsd: string;
  triggeredBy: number | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

export interface AllyGuideEvalResult {
  id: string;
  caseId: string;
  releaseId: string;
  repetition: number;
  passed: boolean;
  safetyFailed: boolean;
  quality: number;
  failedChecks: { id: string; severity: string; detail?: string }[];
  error: string | null;
  latencyMs: number | null;
  costUsd: number;
  /** Only from `/outputs`, which needs the transcripts grant. */
  output?: { reply?: string } & Record<string, unknown>;
}

export interface AllyGuideEvalRunDetail {
  run: AllyGuideEvalRun;
  results: AllyGuideEvalResult[];
}

export interface StartAllyGuideEvalRunBody {
  releaseId: string;
  kind: "smoke" | "gate";
  targetCaseIds?: string[];
}

export interface AllyGuideRedTeamReport {
  trackId: string | null;
  created: number;
  duplicates: number;
  byCategory: Record<string, number>;
  stoppedBy: string | null;
}

// ── The course builder's notes for Ally ──────────────────────────────────────────

export type AllyGuideNotesTension = "low" | "medium" | "high";

export interface AllyGuideNotesItem {
  id: string;
  title: string;
  type: string;
  sectionId: string;
  sectionTitle: string;
  /** What Ally assumes with no override: by type, raised by trigger warnings. */
  defaultTension: AllyGuideNotesTension;
  tension: AllyGuideNotesTension | null;
  triggerWarnings: string[];
}

export interface AllyGuideNotes {
  trackId: string;
  notes: string | null;
  draftedByCopilot: boolean;
  items: AllyGuideNotesItem[];
  notesMaxChars: number;
}

export interface SaveAllyGuideNotesBody {
  trackId: string;
  notes: string | null;
  /** Item id to level, only the overrides. Omitting it clears every override. */
  tension: Record<string, AllyGuideNotesTension>;
  draftedByCopilot?: boolean;
}

export interface AllyGuideNotesDraft {
  draft: {
    notes: string;
    /** Only overrides of the default. */
    tension: Record<string, AllyGuideNotesTension>;
    draftedByCopilot: boolean;
  };
}
