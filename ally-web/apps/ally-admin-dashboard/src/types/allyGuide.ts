/**
 * Wire types for the Ally Console (`/api/v1/guide/admin`, ally-be `src/guide`).
 *
 * Hand-written to the controller's responses rather than generated: the guide's JSON Schema
 * contract covers the learner surface, not the admin one. Where the backend returns a TypeORM
 * entity unchanged, the fields below are the ones the console reads, not the whole row.
 */

/** Safety mode of a thread (ally-be `GuideMode`). */
export type AllyGuideMode = "NORMAL" | "CARE" | "CRISIS" | "CRISIS_FOLLOWUP";

export type AllyGuideThreadStatus = "active" | "merged" | "completed" | "archived";

export type AllyGuideChannel = "text" | "voice" | "event";

export type AllyGuideTurnStatus =
  | "received"
  | "admitted"
  | "streaming"
  | "tool_wait"
  | "completed"
  | "failed"
  | "cancelled"
  | "interrupted";

/** A language Ally has fixed crisis copy and support lines for. */
export type AllyGuideLanguage = "en" | "hi" | "mr" | "ta" | "kn";

// ── Kill switches ────────────────────────────────────────────────────────────────

export interface AllyGuideSwitches {
  enabled: boolean;
  anonymousChat: boolean;
  voice: boolean;
  disabledCapabilities: string[];
  disabledTenants: string[];
  disabledCourses: string[];
}

/** `PUT settings` takes any subset; the server merges it over what is stored. */
export type UpdateAllyGuideSwitchesBody = Partial<AllyGuideSwitches>;

// ── Overview ─────────────────────────────────────────────────────────────────────

export interface AllyGuideTtftRow {
  channel: AllyGuideChannel;
  turns: number;
  p50: number | null;
  p95: number | null;
}

export interface AllyGuideOverview {
  days: number;
  turns: {
    total: number;
    completed: number;
    failed: number;
    interrupted: number;
    /** 0–1, or null when the window holds no turns. */
    successRate: number | null;
  };
  threads: number;
  timeToFirstTokenMs: AllyGuideTtftRow[];
  safety: {
    crises: number;
    crisisReplies: number;
    careEntries: number;
    refusals: number;
    restarts: number;
  };
  cache: {
    readTokens: number;
    uncachedInputTokens: number;
    /** 0–1, or null when no input tokens were recorded. */
    ratio: number | null;
  };
  cost: {
    totalUsd: number;
    perThreadUsd: number | null;
  };
  release: { id: string; version: number; promotedAt: string | null } | null;
  /** The release in canary, or null when none is. */
  canary: { id: string; version: number; percent: number | null } | null;
  /** GA first, then the canary when it has served a turn. */
  arms: AllyGuideArm[];
}

/** One arm of the canary comparison over the window. Rates are 0–1; counts are raw. */
export interface AllyGuideArm {
  arm: "ga" | "canary";
  turns: number;
  threads: number;
  failureRate: number | null;
  ttftP50Ms: number | null;
  costPerThreadUsd: number | null;
  crisisReplies: number;
  careEntries: number;
  refusals: number;
  thumbsUp: number;
  thumbsDown: number;
  /** Learning, beside engagement: for the learners whose thread is in this arm, in the window. */
  quizFirstAttempts: number;
  /** 0–1; null when no first attempt has been graded. */
  quizFirstAttemptPassRate: number | null;
  itemsCompletedPerThread: number | null;
}

// ── Conversations and the Turn Inspector ─────────────────────────────────────────

export interface AllyGuideThreadsQuery {
  limit?: number;
  /** Cursor: the `cursor` of the last row already held. */
  before?: string;
  tenantId?: string;
  mode?: AllyGuideMode;
  status?: AllyGuideThreadStatus;
}

export interface AllyGuideThreadRow {
  id: string;
  trackId: string;
  trackTitle: string | null;
  tenantId: string | null;
  /** The organisation's name, resolved by the server. */
  tenantName: string | null;
  /** An anonymous visitor who has not signed in. Still anonymous: no learner is named. */
  visitor: boolean;
  mode: AllyGuideMode;
  status: AllyGuideThreadStatus;
  epoch: number;
  /** Which arm the conversation's release belongs to, when it was part of a canary. */
  arm: "ga" | "canary" | null;
  updatedAt: string;
  /** Pass as `before` to read the page after this row. Ties on `updatedAt` are never skipped. */
  cursor: string;
  turns: number;
  costUsd: number;
  crises: number;
}

export type AllyGuideStageOutcome = "ok" | "stopped" | "error" | "skipped";

export interface AllyGuideStageTiming {
  stage: string;
  /** Epoch milliseconds. */
  startedAt: number;
  ms: number;
  outcome: AllyGuideStageOutcome;
}

export interface AllyGuideSentinelVerdict {
  risk: string;
  about: string;
  overlay: string | null;
  confidence: number | null;
  source: string;
  latencyMs: number | null;
}

export interface AllyGuideTraceSummary {
  outcome: "completed" | "failed";
  failure: { stage: string; code: string; message: string } | null;
  stages: AllyGuideStageTiming[];
  ttftMs: number | null;
  durationMs: number | null;
  replyKind: string | null;
  epoch: {
    number: number;
    isNew: boolean;
    reason: string | null;
    historyMessages: number;
  } | null;
  model: string | null;
  tier: string | null;
  modeBefore: AllyGuideMode | null;
  modeAfter: AllyGuideMode | null;
  restarted: boolean;
  steer: { level: string | number; reason: string | null } | null;
  sentinel: AllyGuideSentinelVerdict | null;
  tools: { name: string; isError: boolean }[];
  cards: { kind: string; title: string | null }[];
  passes: number;
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number };
  costUsd: number;
  spanHashes: Record<string, string> | null;
}

export interface AllyGuideThreadTrace {
  turnId: string;
  releaseId: string | null;
  summary: AllyGuideTraceSummary;
  createdAt: string;
}

export interface AllyGuideTurn {
  id: string;
  threadId: string;
  trigger: string;
  channel: AllyGuideChannel;
  status: AllyGuideTurnStatus;
  releaseId: string | null;
  errorCode: string | null;
  startedAt: string | null;
  completedAt: string | null;
  ttftMs: number | null;
  durationMs: number | null;
  /** A numeric column: TypeORM returns it as a string. */
  costUsd: string | number;
  createdAt: string;
}

export interface AllyGuideTurnTrace {
  turn: AllyGuideTurn;
  trace: {
    summary: AllyGuideTraceSummary;
    releaseId: string | null;
    hasPayload: boolean;
    createdAt: string;
  } | null;
}

export interface AllyGuideTranscriptMessage {
  id: string;
  seq: number;
  role: "learner" | "ally";
  kind: string;
  turnId: string | null;
  /** Already redacted by the server. */
  text: string;
  flags: { crisis?: boolean; care?: boolean; realCase?: boolean; pii?: boolean } | null;
  createdAt: string | null;
}

export interface AllyGuideTurnPayload {
  situationReport: unknown;
  sentinelEvidence: unknown;
  toolCalls: unknown[];
  reply: string | null;
}

// ── Releases ─────────────────────────────────────────────────────────────────────

export type AllyGuideReleaseStatus =
  | "draft"
  | "evaluating"
  | "candidate"
  | "shadow"
  | "canary"
  | "ga"
  | "retired";

export interface AllyGuideRelease {
  id: string;
  version: number;
  status: AllyGuideReleaseStatus;
  contentHash: string;
  authorKind: "seed" | "human" | "curator";
  notes: string | null;
  promotedAt: string | null;
  retiredAt: string | null;
  createdAt: string;
  /** The share of new conversations a canary release takes, 1–30; null otherwise. */
  rolloutPercent?: number | null;
}

/** Where a rollback would land right now. */
export interface AllyGuideRollbackTarget {
  releaseId: string;
  version: number;
}

export type AllyGuideAuditAction =
  | "created"
  | "status_changed"
  | "promoted"
  | "rolled_back"
  | "emergency_rollback"
  | "note"
  | "canary_started"
  | "canary_stopped";

export interface AllyGuideReleaseAuditRow {
  id: string;
  action: AllyGuideAuditAction;
  releaseId: string | null;
  version: number | null;
  actorKind: "seed" | "human" | "curator";
  actorUserId: number | null;
  actorName: string | null;
  reason: string | null;
  /** Per-action extras: percent, fromVersion, toVersion, emergency, canaryStopped. */
  detail: Record<string, unknown>;
  createdAt: string;
}

export interface StartAllyGuideCanaryBody {
  id: string;
  /** 1–30. */
  percent: number;
  reason?: string;
}

export interface AllyGuidePromptRef {
  code: string;
  version: number;
  text: string;
}

export interface AllyGuideReleaseBundle {
  prompts: Record<string, AllyGuidePromptRef>;
  modelRouting: Record<string, unknown>;
  capabilities: Record<string, boolean>;
  skills?: Record<string, boolean>;
  policy: Record<string, unknown>;
  lessonSnapshot?: string[];
}

export interface AllyGuideReleaseDetail extends AllyGuideRelease {
  bundle: AllyGuideReleaseBundle;
}

export interface AllyGuideRollbackBody {
  /** A safety rollback moves every conversation at its next turn. */
  emergency: boolean;
  reason?: string;
}

// ── Crisis copy (platform and per organisation) ──────────────────────────────────

export interface AllyGuideCrisisResponse {
  id: string;
  scope: "platform" | "tenant";
  tenantId: string | null;
  languageCode: AllyGuideLanguage;
  body: string;
  version: number;
  active: boolean;
  approvedBy: number | null;
  /** Their display name, when they have one on record. */
  approvedByName?: string | null;
  approvedAt: string | null;
}

export interface SaveAllyGuideCrisisResponseBody {
  languageCode: AllyGuideLanguage;
  body: string;
}

// ── Organisation layer ───────────────────────────────────────────────────────────

export interface AllyGuideSupportLine {
  name: string;
  phone: string;
  hours?: string | null;
  url?: string | null;
  isCrisis?: boolean;
}

export interface AllyGuideOrgProfileValue {
  supportLines?: Partial<Record<AllyGuideLanguage, AllyGuideSupportLine[]>>;
  supervisorContact?: string | null;
  supervisorWording?: string | null;
  protocols?: string | null;
  toneNotes?: string | null;
  avoidTopics?: string[];
  outreachEnabled?: boolean;
  emailEnabled?: boolean;
}

export interface AllyGuideOrgProfile {
  tenantId: string;
  /** 0 when the organisation has never saved a profile. */
  version: number;
  profile: AllyGuideOrgProfileValue;
  updatedBy: number | null;
  updatedByName?: string | null;
  updatedAt: string | null;
}

// ── Playground ───────────────────────────────────────────────────────────────────

export type AllyGuidePlaygroundIntent =
  | "start"
  | "continue"
  | "locked_peek"
  | "not_now"
  | "safe_now";

export interface AllyGuidePlaygroundTurn {
  role: "learner" | "ally";
  text: string;
}

/** One dry-run turn of one release. `message` is required unless an `intent` is sent. */
export interface AllyGuidePlaygroundBody {
  releaseId: string;
  trackId: string;
  message: string;
  tenantId?: string;
  /** Items the imagined learner has completed, 0–500. */
  progress?: number;
  mode?: "NORMAL" | "CARE" | "CRISIS_FOLLOWUP";
  guidance?: "lead" | "walk" | "drive";
  channel?: "text" | "voice";
  visitor?: boolean;
  history?: AllyGuidePlaygroundTurn[];
  intent?: AllyGuidePlaygroundIntent;
}

export interface AllyGuidePlaygroundToolCall {
  name: string;
  input: Record<string, unknown>;
  result: string;
  isError: boolean;
  /** True when the tool was a dry run: it reports what it would have done and changed nothing. */
  simulated: boolean;
}

export interface AllyGuidePlaygroundResult {
  release: { id: string; version: number; status: AllyGuideReleaseStatus };
  reply: string;
  replyKind: "crisis" | "refusal" | "model";
  /** The safety monitor's verdict on the message; null when there was no message. */
  sentinel: AllyGuideSentinelVerdict | null;
  situation: string;
  toolCalls: AllyGuidePlaygroundToolCall[];
  model: string | null;
  usage: {
    inputTokens?: number;
    outputTokens?: number;
    cachedTokens?: number;
    cacheCreationTokens?: number;
  }[];
  costUsd: number;
  latencyMs: number;
}

// ── Alerts ───────────────────────────────────────────────────────────────────────

export type AllyGuideAlertRule =
  | "turn_failures"
  | "ttft_slo"
  | "cost_anomaly"
  | "crisis_spike"
  | "anonymous_cap"
  | "cache_health";

export type AllyGuideAlertDelivery = "posted" | "no_channel" | "failed";

export interface AllyGuideAlertCounts {
  open: number;
  total: number;
}

export interface AllyGuideAlert {
  id: string;
  rule: AllyGuideAlertRule | string;
  severity: "warning" | "critical";
  summary: string;
  /** The numbers behind it. Never a learner, an organisation or a message. */
  value: Record<string, unknown>;
  /** Null when it was not posted to the team channel (none is configured, or the post failed). */
  notifiedAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: number | null;
  acknowledgedByName?: string | null;
  /** Where it went; null on an alert raised before delivery was recorded. */
  delivery?: AllyGuideAlertDelivery | null;
  createdAt: string;
}

// ── Baseline ─────────────────────────────────────────────────────────────────────

/** One cohort's numbers in a baseline snapshot. Rates are 0–1. */
export interface AllyGuideBaselineCohort {
  enrollments: number;
  completionRate: number | null;
  medianDaysToComplete: number | null;
  itemsCompletedPerEnrollment: number | null;
  firstDayWinRate: number | null;
  returnWithin7dRate: number | null;
  quizFirstAttempts: number;
  quizFirstAttemptPassRate: number | null;
}

export interface AllyGuideBaselineSnapshot {
  id: string;
  windowDays: number;
  windowStart: string;
  windowEnd: string;
  capturedByUserId: number | null;
  capturedByName?: string | null;
  /** True on the very first snapshot ever taken: the pre-launch baseline, even beyond the page. */
  first?: boolean;
  note: string | null;
  metrics: {
    /** Keyed by entry source: unknown, public_link, in_app, guided, outreach, and all. */
    cohorts: Record<string, AllyGuideBaselineCohort>;
    publicCourses: number;
    /** The server's own wording for each metric. */
    definitions: Record<string, string>;
  };
  createdAt: string;
}

export interface CaptureAllyGuideBaselineBody {
  /** 7–365. */
  windowDays: number;
  note?: string;
}
