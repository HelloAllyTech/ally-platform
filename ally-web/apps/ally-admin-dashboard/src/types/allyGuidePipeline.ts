/**
 * Types for the learning loop's second half (plan §7.13 loop 2): progressive delegation, the
 * curator and its playbook, a release's trail, shadow reports, the canary's automatic decision and
 * synthetic monitoring. They mirror `GuideLearningAdminController` and `src/guide-learning/pipeline/`.
 */

// ── Progressive delegation (Appendix A) ──────────────────────────────────────────

export type AllyGuideDelegationStage = 1 | 2 | 3;

export interface AllyGuidePrecondition {
  id: string;
  label: string;
  /** The lowest stage that needs it. */
  stage: AllyGuideDelegationStage;
  need: number;
  /** The actual count; null when there is nothing to count yet. */
  have: number | null;
  met: boolean;
}

export interface AllyGuideDelegation {
  stage: AllyGuideDelegationStage;
  label: string;
  /** The highest stage whose preconditions all hold. */
  unlocked: AllyGuideDelegationStage;
  changedAt: string | null;
  /** A bare user id; null when the system lowered it. */
  changedBy: number | null;
  reason: string | null;
  preconditions: AllyGuidePrecondition[];
  stages: { stage: AllyGuideDelegationStage; label: string; unlocked: boolean }[];
  /** Always true: a bad canary is reverted whatever the stage. */
  autoRevert: boolean;
}

export interface SetAllyGuideDelegationBody {
  stage: AllyGuideDelegationStage;
  reason?: string;
}

// ── Curator, lessons and the playbook ────────────────────────────────────────────

export type AllyGuideLessonStatus =
  | "proposed"
  | "quarantined"
  | "approved"
  | "active"
  | "blocked"
  | "rejected"
  | "retired";
export type AllyGuideLessonScope = "platform" | "org" | "course";

export interface AllyGuideLesson {
  id: string;
  kind: "lesson" | "policy" | "prompt";
  scope: AllyGuideLessonScope;
  tenantId: string | null;
  trackId: string | null;
  status: AllyGuideLessonStatus;
  /** Written by the curator, never a learner's words. */
  text: string;
  change: Record<string, unknown> | null;
  rationale: string | null;
  evidence: Record<string, unknown>;
  /** Why a guardrail stopped it. */
  blockReason: string | null;
  releaseId: string | null;
  authorKind: string;
  decidedBy: number | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface AllyGuideLessonsQuery {
  status?: AllyGuideLessonStatus;
  scope?: AllyGuideLessonScope;
  limit?: number;
}

export interface AllyGuidePlaybookLesson {
  id: string;
  scope: AllyGuideLessonScope;
  tenantId?: string | null;
  trackId?: string | null;
  text: string;
}

export interface AllyGuidePlaybook {
  releaseId: string | null;
  version: number | null;
  caps?: {
    platform: { used: number; max: number };
    org: { max: number; used: Record<string, number> };
    course: { max: number; used: Record<string, number> };
  };
  lessons: AllyGuidePlaybookLesson[];
}

export type AllyGuideLearningAuditAction =
  | "proposed"
  | "quarantined"
  | "blocked"
  | "approved"
  | "rejected"
  | "activated"
  | "retired"
  | "curator_run"
  | "stage_changed"
  | "pipeline_step";

export interface AllyGuideLearningAuditRow {
  id: string;
  lessonId: string | null;
  releaseId: string | null;
  action: AllyGuideLearningAuditAction;
  actorKind: string;
  actorUserId: number | null;
  detail: Record<string, unknown> | null;
  createdAt: string;
}

// ── A release's trail, shadow and the canary's decision ──────────────────────────

export interface AllyGuideTrailRow {
  at: string;
  source: "release" | "learning";
  action: string;
  actorKind: string;
  actorUserId: number | null;
  lessonId?: string | null;
  detail: Record<string, unknown> | null;
}

export interface AllyGuideReleaseTrail {
  release: {
    id: string;
    version: number;
    status: string;
    authorKind: string;
    evalRunId: string | null;
    shadowReportId: string | null;
    changeSet: Record<string, unknown> | null;
  };
  trail: AllyGuideTrailRow[];
}

export type AllyGuideShadowStatus = "running" | "passed" | "failed" | "inconclusive" | "error";

export interface AllyGuideShadowSide {
  passRate: number | null;
  safetyFailures: number;
  meanWords: number | null;
}

export interface AllyGuideShadowSummary {
  status?: AllyGuideShadowStatus;
  reasons?: string[];
  turns?: number;
  errors?: number;
  ga?: AllyGuideShadowSide;
  candidate?: AllyGuideShadowSide;
  /** Turns where the candidate failed a safety check GA passed. */
  newSafetyFailures?: number;
  /** Turns where one side gave the crisis response and the other did not. */
  crisisDisagreements?: number;
  /** Check id to [GA failures, candidate failures]. */
  byCheck?: Record<string, [number, number]>;
  /** Present when the run itself failed. */
  error?: string;
}

export interface AllyGuideShadowReport {
  id: string;
  releaseId: string;
  baselineReleaseId: string | null;
  status: AllyGuideShadowStatus;
  turnCount: number;
  summary: AllyGuideShadowSummary;
  costUsd: string;
  triggeredBy: number | null;
  completedAt: string | null;
  createdAt: string;
}

export type AllyGuideCanaryAction = "wait" | "promote" | "revert";

export interface AllyGuideCanaryArmStats {
  threads: number;
  turns: number;
  failureRate: number | null;
  ratedTurns: number;
  judgedWindows: number;
  safetyFailureWindows: number;
}

export interface AllyGuideCanaryDecision {
  action: AllyGuideCanaryAction;
  /** A safety reason: every canary conversation moves to GA at its next turn. */
  emergency: boolean;
  reasons: string[];
  ready: boolean;
  thresholds: Record<string, { need: number; have: number; met: boolean }>;
  criteria: {
    id: string;
    gaRate: number | null;
    canaryRate: number | null;
    verdict: "better" | "same" | "worse" | "too_few";
  }[];
  guard: { status: "pass" | "fail" | "pending"; reason: string };
}

export interface AllyGuideCanaryStatus {
  canary: { id: string; version: number; percent: number | null; authorKind: string } | null;
  stage?: AllyGuideDelegationStage;
  decision?: AllyGuideCanaryDecision;
  evidence?: {
    daysRunning: number;
    ga: AllyGuideCanaryArmStats | null;
    canary: AllyGuideCanaryArmStats | null;
    trusted: string[];
  };
  promotesAutomatically?: boolean;
}

// ── Synthetic monitoring ─────────────────────────────────────────────────────────

export interface AllyGuideSyntheticStep {
  passed: boolean;
  safetyFailed: boolean;
  failedChecks: string[];
  replyKind: string | null;
  latencyMs: number | null;
  error: string | null;
}

export interface AllyGuideSyntheticJourney {
  key: string;
  persona: string;
  trackId: string;
  passed: boolean;
  steps: AllyGuideSyntheticStep[];
}

export interface AllyGuideSyntheticRun {
  id: string;
  releaseId: string;
  night: string;
  status: "running" | "completed" | "error";
  journeys: number;
  turns: number;
  passRate: number | null;
  safetyFailures: number;
  drift: boolean;
  summary: {
    releaseVersion?: number;
    courses?: string[];
    verdict?: {
      drift: boolean;
      reasons: string[];
      baselineMedian: number | null;
      newlyFailing: string[];
    };
    journeys?: AllyGuideSyntheticJourney[];
    error?: string;
  };
  costUsd: string;
  completedAt: string | null;
  createdAt: string;
}
