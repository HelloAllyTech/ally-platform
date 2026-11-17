/**
 * PM Agent admin types, coded to the REST contract in ally-be `docs/pm-agent.md`.
 * Names are prefixed `Pm…` because `PmAgentState` and friends already belong to the debrief
 * console's idea agent (`types/debriefConsole.ts`).
 */

export type PmCardKind = "recommendation" | "question";

export type PmCardCategory =
  | "ui_ux"
  | "product"
  | "architecture"
  | "code_health"
  | "infra"
  | "cost"
  | "strategy_content";

export type PmCardStatus =
  | "draft"
  | "open"
  | "accepted_pending"
  | "queued"
  | "designing"
  | "building"
  | "pr_open"
  | "merged"
  | "released"
  | "failed"
  | "needs_attention"
  | "merged_not_released"
  | "handed_off"
  | "rejected"
  | "feedback_closed"
  | "answered"
  | "skipped"
  | "expired"
  | "superseded";

/** Derived by the backend for the UI. */
export type PmAgentRunState =
  | "disabled"
  | "idle"
  | "running"
  | "queue_full"
  | "budget_exhausted"
  | "paused";

export type PmRiskLevel = "low" | "medium" | "high";
export type PmCardSize = "S" | "M";
export type PmQuestionScope = "global" | "feature" | "tenant";
export type PmRepo = "ally-be" | "ally-web" | "ally-ai" | "ally-ai-learn";
export type PmReasonChip =
  | "not_priority"
  | "already_planned"
  | "wrong_idea"
  | "too_risky"
  | "other";

export interface PmRecommendationPayload {
  schemaVersion: 1;
  title: string;
  whyHeadline: string;
  change: string[];
  problem: string;
  plan: {
    steps: string[];
    files: string[];
    acceptanceCriteria: string[];
    testPlan: string[];
    defaultsChosen: string[];
  };
  size: PmCardSize;
  risk: PmRiskLevel;
  riskWhy: string;
  rollbackNote: string;
  impactMetric?: { name: string; direction: string } | null;
  alternativesDropped: string[];
  repos: PmRepo[];
  evidenceIds: string[];
}

export interface PmQuestionOption {
  label: string;
  consequence: string;
  suggested?: boolean;
}

export interface PmQuestionPayload {
  schemaVersion: 1;
  title: string;
  askedBecause: string;
  usedFor: string;
  options: PmQuestionOption[];
  scope: PmQuestionScope;
}

export interface PmPullRequest {
  url: string;
  state?: string;
  ciStatus?: string;
  merged?: boolean;
  releaseState?: string;
  releaseTag?: string | null;
}

export interface PmDelivery {
  status: string;
  prs: PmPullRequest[];
  costUsd?: number | null;
}

/** An item that needs a person: a failed build, a merged-but-not-released change. */
export interface PmNeedsYou {
  reason: string;
  /** Action keys the backend offers, e.g. `retry`, `dismiss`; `open_pr` is also derived from `delivery`. */
  actions: string[];
}

export interface PmEvidence {
  id: string;
  label?: string;
  summary?: string;
  value?: string | number | null;
  source?: string | null;
  url?: string | null;
  capturedAt?: string | null;
}

export interface PmCardEvent {
  id?: string;
  type?: string;
  at?: string;
  actor?: string | null;
  [key: string]: unknown;
}

export interface PmCard {
  id: string;
  kind: PmCardKind;
  category: PmCardCategory;
  status: PmCardStatus;
  version: number;
  versionHash: string;
  title: string;
  payload: PmRecommendationPayload | PmQuestionPayload;
  rank: number;
  /** ISO timestamp of the oldest evidence, or an age in days. Rendered defensively. */
  evidenceFreshness?: string | number | null;
  createdAt: string;
  decidedAt?: string | null;
  decidedBy?: string | null;
  undoUntil?: string | null;
  needsYou?: PmNeedsYou | null;
  delivery?: PmDelivery | null;
  revisedFromCardId?: string | null;
  /** Only on `GET /cards/:id`. */
  evidence?: PmEvidence[];
  events?: PmCardEvent[];
}

export interface PmSettings {
  enabled: boolean;
  monthlyBudgetUsd: number;
  queueCap: number;
  runHourIst: number;
  mandate: string;
  pauseAutoBuild: boolean;
  slackNotify: boolean;
  categoryWeights?: Record<string, number> | null;
}

export type PmSettingsPatch = Partial<PmSettings>;

export interface PmRun {
  id?: string;
  status: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  cardsCreated?: number | null;
  costUsd?: number | null;
  error?: string | null;
  [key: string]: unknown;
}

export interface PmAgentStateResponse {
  agentState: PmAgentRunState;
  stopReason?: string | null;
  settings: PmSettings;
  budget: { monthlyBudgetUsd: number; spentUsd: number; reservedUsd: number };
  queue: { open: number; cap: number; needsYou: number };
  lastRun?: PmRun | null;
  nextRunAt?: string | null;
  autoBuildPaused: boolean;
}

export interface PmCardsResponse {
  cards: PmCard[];
}

export interface PmTrackingResponse {
  needsYou: PmCard[];
  inProgress: PmCard[];
  shipped: PmCard[];
  other: PmCard[];
}

export interface PmRunNowResponse {
  runId?: string;
  started: boolean;
  reason?: string;
}

export interface PmMemoryFact {
  id: string;
  value: string;
  active?: boolean;
  kind?: string;
  source?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PmLesson {
  id?: string;
  text?: string;
  lesson?: string;
  summary?: string;
  category?: string;
  createdAt?: string;
  [key: string]: unknown;
}

export interface PmMemoryResponse {
  facts: PmMemoryFact[];
  lessons: PmLesson[];
}

export interface PmHealth {
  acceptRate7d?: number | null;
  acceptRate30d?: number | null;
  shippedRate?: number | null;
  costPerAcceptedCardUsd?: number | null;
  spendByLane?: Record<string, number> | null;
  repeatedRejectionRate?: number | null;
}

export interface PmDecisionInput {
  id: string;
}

export interface PmRejectInput extends PmDecisionInput {
  reason?: string;
  reasonChip?: PmReasonChip;
}

export interface PmFeedbackInput extends PmDecisionInput {
  text: string;
  chips?: string[];
  reviseNow?: boolean;
}

export interface PmAnswerInput extends PmDecisionInput {
  optionIndex?: number;
  customText?: string;
}
