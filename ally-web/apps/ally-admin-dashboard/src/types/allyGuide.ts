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
}

// ── Conversations and the Turn Inspector ─────────────────────────────────────────

export interface AllyGuideThreadsQuery {
  limit?: number;
  /** Cursor: the `updatedAt` of the last row already held. */
  before?: string;
  tenantId?: string;
  mode?: AllyGuideMode;
}

export interface AllyGuideThreadRow {
  id: string;
  trackId: string;
  trackTitle: string | null;
  tenantId: string | null;
  mode: AllyGuideMode;
  status: AllyGuideThreadStatus;
  epoch: number;
  updatedAt: string;
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
  /** A bare user id: the API returns no name. */
  approvedBy: number | null;
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
  updatedAt: string | null;
}
